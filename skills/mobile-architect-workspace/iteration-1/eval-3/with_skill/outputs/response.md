# TCA Paginated Product List with Offline Support

## 1. Architectural Blueprint

The feature is modeled as a single TCA `Reducer` (`ProductListFeature`) that owns a `State` struct with immutable snapshots of the current page cursor, loaded products, loading/error status, and a flag indicating whether data was served from cache. Actions flow unidirectionally: UI sends `Action` values, the reducer transforms state synchronously, and async work is dispatched as `Effect` values that feed new actions back in. The `APIClient` and `CoreDataClient` are injected via TCA's `DependencyValues`, making both fully testable without mocking at the call-site. On launch the reducer first loads persisted products from CoreData so the list is immediately populated, then fires the first page fetch in the background — this gives a perceived "instant load" while maintaining a live view of fresh data. Pagination is cursor-based; the reducer refuses to fire a second in-flight fetch if `isLoadingMore` is already `true`, preventing duplicate page requests. Pull-to-refresh resets the cursor and re-fetches page 1 while keeping the stale list visible until the first new page arrives. Every error path surfaces a `SnackbarError` state that drives a retry button; the retry re-sends the last failed action, so no special retry logic is duplicated. CoreData writes happen on a private background context and are fenced by a serial actor to avoid core-data concurrency violations.

---

## 2. The Implementation

### File Structure

```
Features/
  ProductList/
    ProductListFeature.swift       ← Reducer + State + Action
    ProductListView.swift          ← SwiftUI view
Clients/
    APIClient.swift                ← URLSession dependency
    CoreDataClient.swift           ← CoreData dependency
Models/
    Product.swift                  ← Domain model
CoreData/
    ProductStore.xcdatamodeld      ← (add via Xcode — schema described below)
    ProductEntity+CoreData.swift   ← NSManagedObject subclass helper
```

---

### Models/Product.swift

```swift
import Foundation

/// Canonical domain model. Decoupled from both the API DTO and the CoreData entity.
public struct Product: Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let description: String
    public let priceInCents: Int
    public let imageURL: URL?
    public let createdAt: Date

    public init(
        id: String,
        name: String,
        description: String,
        priceInCents: Int,
        imageURL: URL?,
        createdAt: Date
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.priceInCents = priceInCents
        self.imageURL = imageURL
        self.createdAt = createdAt
    }
}

// MARK: - API DTO

struct ProductDTO: Decodable {
    let id: String
    let name: String
    let description: String
    let price_cents: Int
    let image_url: String?
    let created_at: String

    func toDomain() throws -> Product {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: created_at) else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: [], debugDescription: "Invalid date: \(created_at)")
            )
        }
        return Product(
            id: id,
            name: name,
            description: description,
            priceInCents: price_cents,
            imageURL: image_url.flatMap { URL(string: $0) },
            createdAt: date
        )
    }
}

struct ProductPage: Decodable {
    let data: [ProductDTO]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case data
        case nextCursor = "next_cursor"
    }
}
```

---

### CoreData/ProductEntity+CoreData.swift

```swift
import CoreData

/// Describes the NSManagedObject subclass generated from the .xcdatamodeld.
/// Entity name: "ProductEntity"
/// Attributes: id (String), name (String), desc (String),
///             priceInCents (Integer 64), imageURLString (String, optional),
///             createdAt (Date)
@objc(ProductEntity)
public class ProductEntity: NSManagedObject {
    @NSManaged public var id: String
    @NSManaged public var name: String
    @NSManaged public var desc: String
    @NSManaged public var priceInCents: Int64
    @NSManaged public var imageURLString: String?
    @NSManaged public var createdAt: Date

    func toDomain() -> Product {
        Product(
            id: id,
            name: name,
            description: desc,
            priceInCents: Int(priceInCents),
            imageURL: imageURLString.flatMap { URL(string: $0) },
            createdAt: createdAt
        )
    }

    static func upsert(from product: Product, in context: NSManagedObjectContext) {
        let request: NSFetchRequest<ProductEntity> = NSFetchRequest(entityName: "ProductEntity")
        request.predicate = NSPredicate(format: "id == %@", product.id)
        request.fetchLimit = 1

        let entity = (try? context.fetch(request))?.first ?? ProductEntity(context: context)
        entity.id = product.id
        entity.name = product.name
        entity.desc = product.description
        entity.priceInCents = Int64(product.priceInCents)
        entity.imageURLString = product.imageURL?.absoluteString
        entity.createdAt = product.createdAt
    }
}
```

---

### Clients/CoreDataClient.swift

```swift
import CoreData
import Dependencies
import Foundation
import os.log

// MARK: - Interface

struct CoreDataClient: Sendable {
    var fetchProducts: @Sendable () async throws -> [Product]
    var saveProducts: @Sendable ([Product]) async throws -> Void
    var deleteAllProducts: @Sendable () async throws -> Void
}

// MARK: - Live implementation

extension CoreDataClient {
    static let live: Self = {
        let stack = CoreDataStack.shared

        return CoreDataClient(
            fetchProducts: {
                try await stack.perform {
                    let request: NSFetchRequest<ProductEntity> = NSFetchRequest(entityName: "ProductEntity")
                    request.sortDescriptors = [NSSortDescriptor(key: "createdAt", ascending: false)]
                    return try stack.backgroundContext.fetch(request).map { $0.toDomain() }
                }
            },
            saveProducts: { products in
                try await stack.perform {
                    products.forEach { ProductEntity.upsert(from: $0, in: stack.backgroundContext) }
                    if stack.backgroundContext.hasChanges {
                        try stack.backgroundContext.save()
                    }
                }
            },
            deleteAllProducts: {
                try await stack.perform {
                    let request = NSBatchDeleteRequest(fetchRequest: NSFetchRequest(entityName: "ProductEntity"))
                    try stack.backgroundContext.execute(request)
                }
            }
        )
    }()

    static let testValue = CoreDataClient(
        fetchProducts: { [] },
        saveProducts: { _ in },
        deleteAllProducts: {}
    )
}

// MARK: - CoreData stack

/// Thread-safe CoreData stack using a serial actor to serialise background work.
private actor CoreDataStack {
    static let shared = CoreDataStack()

    private let container: NSPersistentContainer
    let backgroundContext: NSManagedObjectContext

    private init() {
        container = NSPersistentContainer(name: "ProductStore")
        container.loadPersistentStores { _, error in
            if let error {
                // Fatal — the app cannot function without local storage.
                fatalError("CoreData failed to load: \(error)")
            }
        }
        container.viewContext.automaticallyMergesChangesFromParent = true
        backgroundContext = container.newBackgroundContext()
        backgroundContext.mergePolicy = NSMergeByPropertyObjectTrumpMergePolicy
    }

    func perform<T: Sendable>(_ block: @escaping () throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            backgroundContext.perform {
                do {
                    continuation.resume(returning: try block())
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }
}

// MARK: - Dependency key

private enum CoreDataClientKey: DependencyKey {
    static let liveValue = CoreDataClient.live
    static let testValue = CoreDataClient.testValue
}

extension DependencyValues {
    var coreDataClient: CoreDataClient {
        get { self[CoreDataClientKey.self] }
        set { self[CoreDataClientKey.self] = newValue }
    }
}
```

---

### Clients/APIClient.swift

```swift
import Dependencies
import Foundation
import os.log

private let logger = Logger(subsystem: "com.yourapp.products", category: "APIClient")

// MARK: - Interface

struct APIClient: Sendable {
    var fetchProducts: @Sendable (_ cursor: String?, _ pageSize: Int) async throws -> ProductPage
}

// MARK: - Live implementation

extension APIClient {
    static let live = APIClient(
        fetchProducts: { cursor, pageSize in
            var components = URLComponents(string: "https://api.example.com/v1/products")!
            var queryItems: [URLQueryItem] = [
                URLQueryItem(name: "page_size", value: "\(pageSize)")
            ]
            if let cursor {
                queryItems.append(URLQueryItem(name: "cursor", value: cursor))
            }
            components.queryItems = queryItems

            guard let url = components.url else {
                throw URLError(.badURL)
            }

            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            // Add auth header from Keychain here in production:
            // request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

            logger.info("Fetching products page cursor=\(cursor ?? "start", privacy: .public)")

            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw URLError(.badServerResponse)
            }

            guard (200..<300).contains(httpResponse.statusCode) else {
                logger.error("Products fetch failed: HTTP \(httpResponse.statusCode, privacy: .public)")
                throw APIError.httpError(statusCode: httpResponse.statusCode)
            }

            do {
                let page = try JSONDecoder().decode(ProductPage.self, from: data)
                logger.info("Fetched \(page.data.count, privacy: .public) products")
                return page
            } catch {
                logger.error("Decoding error: \(error.localizedDescription, privacy: .public)")
                throw APIError.decodingFailed(error)
            }
        }
    )

    static let testValue = APIClient(
        fetchProducts: { _, _ in ProductPage(data: [], nextCursor: nil) }
    )
}

// MARK: - Error types

enum APIError: Error, Equatable, LocalizedError {
    case httpError(statusCode: Int)
    case decodingFailed(Error)
    case unknown

    static func == (lhs: APIError, rhs: APIError) -> Bool {
        switch (lhs, rhs) {
        case (.httpError(let a), .httpError(let b)): return a == b
        case (.decodingFailed, .decodingFailed): return true
        case (.unknown, .unknown): return true
        default: return false
        }
    }

    var errorDescription: String? {
        switch self {
        case .httpError(let code): return "Server returned error \(code). Please try again."
        case .decodingFailed: return "Could not read the server response. Please update the app."
        case .unknown: return "An unexpected error occurred. Please try again."
        }
    }
}

// MARK: - Dependency key

private enum APIClientKey: DependencyKey {
    static let liveValue = APIClient.live
    static let testValue = APIClient.testValue
}

extension DependencyValues {
    var apiClient: APIClient {
        get { self[APIClientKey.self] }
        set { self[APIClientKey.self] = newValue }
    }
}
```

---

### Features/ProductList/ProductListFeature.swift

```swift
import ComposableArchitecture
import Foundation
import os.log

private let logger = Logger(subsystem: "com.yourapp.products", category: "ProductListFeature")

// MARK: - Feature

@Reducer
struct ProductListFeature {

    // MARK: State

    @ObservableState
    struct State: Equatable {
        var products: [Product] = []
        var isLoadingFirstPage: Bool = false
        var isLoadingMore: Bool = false
        var isRefreshing: Bool = false
        var nextCursor: String? = nil
        var hasMorePages: Bool = true
        var errorMessage: String? = nil
        var isServingFromCache: Bool = false

        /// True when there is no data at all — first load or after a full clear.
        var isEmpty: Bool { products.isEmpty && !isLoadingFirstPage }
        /// True if the current request (any kind) is in-flight.
        var isAnyRequestInFlight: Bool { isLoadingFirstPage || isLoadingMore || isRefreshing }
    }

    // MARK: Actions

    enum Action: Equatable {
        // Lifecycle
        case onAppear

        // User intent
        case refreshTriggered
        case loadMoreTriggered
        case retryTapped

        // Internal effects → reducer
        case cacheLoaded(Result<[Product], Error>)
        case pageLoaded(Result<ProductPage, Error>, isRefresh: Bool)
        case cacheSaved(Result<Void, Error>)

        static func == (lhs: Action, rhs: Action) -> Bool {
            switch (lhs, rhs) {
            case (.onAppear, .onAppear),
                 (.refreshTriggered, .refreshTriggered),
                 (.loadMoreTriggered, .loadMoreTriggered),
                 (.retryTapped, .retryTapped):
                return true
            case (.cacheLoaded(let a), .cacheLoaded(let b)):
                return resultEquatable(a, b) { $0 == $1 }
            case (.pageLoaded(let a, let ia), .pageLoaded(let b, let ib)):
                return ia == ib && resultEquatable(a, b) { lhsPage, rhsPage in
                    lhsPage.nextCursor == rhsPage.nextCursor &&
                    (try? lhsPage.data.map { try $0.toDomain() }) ==
                    (try? rhsPage.data.map { try $0.toDomain() })
                }
            case (.cacheSaved, .cacheSaved):
                return true
            default:
                return false
            }
        }
    }

    static let pageSize = 20

    // MARK: Dependencies

    @Dependency(\.apiClient) var apiClient
    @Dependency(\.coreDataClient) var coreDataClient

    // MARK: Reducer body

    var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {

            // ─── Lifecycle ──────────────────────────────────────────────

            case .onAppear:
                guard !state.isAnyRequestInFlight else { return .none }
                state.isLoadingFirstPage = true
                state.errorMessage = nil
                return .run { send in
                    await send(.cacheLoaded(Result {
                        try await coreDataClient.fetchProducts()
                    }))
                }

            // ─── Cache loaded ────────────────────────────────────────────

            case .cacheLoaded(.success(let cached)):
                if !cached.isEmpty {
                    state.products = cached
                    state.isServingFromCache = true
                    logger.info("Loaded \(cached.count) products from cache")
                }
                // Always follow up with a live fetch regardless of cache hit.
                return fetchPage(cursor: nil, isRefresh: false)

            case .cacheLoaded(.failure(let error)):
                // Non-fatal — proceed to network fetch even if cache read fails.
                logger.error("Cache read failed: \(error.localizedDescription, privacy: .public)")
                return fetchPage(cursor: nil, isRefresh: false)

            // ─── Pull-to-refresh ─────────────────────────────────────────

            case .refreshTriggered:
                guard !state.isRefreshing else { return .none }
                state.isRefreshing = true
                state.errorMessage = nil
                // Cancel any in-flight pagination to avoid stale appends.
                return .concatenate(
                    .cancel(id: PaginationCancelID()),
                    fetchPage(cursor: nil, isRefresh: true)
                )

            // ─── Pagination ───────────────────────────────────────────────

            case .loadMoreTriggered:
                guard
                    !state.isAnyRequestInFlight,
                    state.hasMorePages,
                    let cursor = state.nextCursor
                else { return .none }
                state.isLoadingMore = true
                return fetchPage(cursor: cursor, isRefresh: false)
                    .cancellable(id: PaginationCancelID())

            // ─── Retry ────────────────────────────────────────────────────

            case .retryTapped:
                guard !state.isAnyRequestInFlight else { return .none }
                state.errorMessage = nil
                if state.products.isEmpty {
                    // Full re-load from cache → network.
                    state.isLoadingFirstPage = true
                    return .run { send in
                        await send(.cacheLoaded(Result {
                            try await coreDataClient.fetchProducts()
                        }))
                    }
                } else {
                    // Retry the next page from the last known cursor.
                    state.isLoadingMore = true
                    return fetchPage(cursor: state.nextCursor, isRefresh: false)
                        .cancellable(id: PaginationCancelID())
                }

            // ─── Page loaded ──────────────────────────────────────────────

            case .pageLoaded(.success(let page), let isRefresh):
                state.isLoadingFirstPage = false
                state.isLoadingMore = false
                state.isRefreshing = false
                state.isServingFromCache = false
                state.errorMessage = nil

                let newProducts: [Product]
                do {
                    newProducts = try page.data.map { try $0.toDomain() }
                } catch {
                    state.errorMessage = "Could not read server data. Please try again."
                    logger.error("DTO→Domain conversion failed: \(error.localizedDescription, privacy: .public)")
                    return .none
                }

                if isRefresh {
                    state.products = newProducts
                } else {
                    // De-duplicate by ID before appending to handle overlapping cursors.
                    let existingIDs = Set(state.products.map(\.id))
                    let unique = newProducts.filter { !existingIDs.contains($0.id) }
                    state.products.append(contentsOf: unique)
                }

                state.nextCursor = page.nextCursor
                state.hasMorePages = page.nextCursor != nil

                logger.info(
                    "Page loaded: \(newProducts.count) items, hasMore=\(state.hasMorePages, privacy: .public)"
                )

                // Persist the refreshed/new data in the background.
                let toSave = newProducts
                return .run { send in
                    await send(.cacheSaved(Result {
                        if isRefresh {
                            try await coreDataClient.deleteAllProducts()
                        }
                        try await coreDataClient.saveProducts(toSave)
                    }))
                }

            case .pageLoaded(.failure(let error), _):
                state.isLoadingFirstPage = false
                state.isLoadingMore = false
                state.isRefreshing = false

                let message: String
                if let apiError = error as? APIError {
                    message = apiError.errorDescription ?? "Unknown error"
                } else if (error as? URLError)?.code == .notConnectedToInternet {
                    message = state.products.isEmpty
                        ? "No internet connection and no cached data available."
                        : "No internet connection. Showing cached data."
                } else {
                    message = "Failed to load products. Please try again."
                }
                state.errorMessage = message
                logger.error("Page load failed: \(error.localizedDescription, privacy: .public)")
                return .none

            // ─── Cache saved ──────────────────────────────────────────────

            case .cacheSaved(.success):
                logger.info("Products persisted to CoreData")
                return .none

            case .cacheSaved(.failure(let error)):
                // Non-fatal: the UI already has fresh data; log and continue.
                logger.error("Cache save failed: \(error.localizedDescription, privacy: .public)")
                return .none
            }
        }
    }

    // MARK: - Private helpers

    private func fetchPage(cursor: String?, isRefresh: Bool) -> Effect<Action> {
        .run { send in
            await send(.pageLoaded(
                Result { try await apiClient.fetchProducts(cursor, ProductListFeature.pageSize) },
                isRefresh: isRefresh
            ))
        }
    }
}

// MARK: - Cancel ID

private struct PaginationCancelID: Hashable {}

// MARK: - ProductPage Equatable helper

private func resultEquatable<T, E: Error>(
    _ lhs: Result<T, E>,
    _ rhs: Result<T, E>,
    compare: (T, T) throws -> Bool
) -> Bool {
    switch (lhs, rhs) {
    case (.success(let a), .success(let b)):
        return (try? compare(a, b)) ?? false
    case (.failure, .failure):
        return true
    default:
        return false
    }
}
```

---

### Features/ProductList/ProductListView.swift

```swift
import ComposableArchitecture
import SwiftUI

// MARK: - Root view

struct ProductListView: View {
    @Bindable var store: StoreOf<ProductListFeature>

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Products")
                .toolbar {
                    if store.isServingFromCache {
                        ToolbarItem(placement: .navigationBarTrailing) {
                            Label("Cached", systemImage: "clock.arrow.circlepath")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
        }
        .onAppear { store.send(.onAppear) }
    }

    @ViewBuilder
    private var content: some View {
        if store.isLoadingFirstPage && store.products.isEmpty {
            loadingView
        } else if store.isEmpty, let error = store.errorMessage {
            errorView(message: error)
        } else {
            productList
        }
    }

    // MARK: Loading placeholder

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text("Loading products…")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Full-screen error (empty state)

    private func errorView(message: String) -> some View {
        VStack(spacing: 20) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 44))
                .foregroundStyle(.orange)
            Text(message)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 32)
            Button("Retry") { store.send(.retryTapped) }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Product list

    private var productList: some View {
        List {
            ForEach(store.products) { product in
                ProductRowView(product: product)
                    .onAppear {
                        // Trigger load-more when the last visible item appears.
                        if product.id == store.products.last?.id {
                            store.send(.loadMoreTriggered)
                        }
                    }
            }

            if store.isLoadingMore {
                HStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
                .listRowSeparator(.hidden)
            }

            if let error = store.errorMessage, !store.products.isEmpty {
                inlineErrorRow(message: error)
            }
        }
        .listStyle(.plain)
        .refreshable {
            // refreshable suspends until the action completes; we bridge with
            // a continuation so SwiftUI's pull-to-refresh spinner is dismissed
            // at the right time.
            await store.send(.refreshTriggered).finish()
        }
    }

    // MARK: Inline error row (pagination failure)

    private func inlineErrorRow(message: String) -> some View {
        VStack(spacing: 8) {
            Text(message)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Retry") { store.send(.retryTapped) }
                .font(.footnote)
                .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .listRowSeparator(.hidden)
    }
}

// MARK: - Product row

struct ProductRowView: View {
    let product: Product

    private var formattedPrice: String {
        let value = Double(product.priceInCents) / 100.0
        return value.formatted(.currency(code: "USD"))
    }

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: product.imageURL) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                case .failure:
                    Image(systemName: "photo")
                        .foregroundStyle(.tertiary)
                default:
                    ProgressView()
                }
            }
            .frame(width: 60, height: 60)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .background(Color(.systemGray6))

            VStack(alignment: .leading, spacing: 4) {
                Text(product.name)
                    .font(.headline)
                    .lineLimit(1)
                Text(product.description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                Text(formattedPrice)
                    .font(.callout)
                    .fontWeight(.semibold)
                    .foregroundStyle(.blue)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - App entry / store wiring

// In your App.swift or SceneDelegate:
//
// @main
// struct MyApp: App {
//     var body: some Scene {
//         WindowGroup {
//             ProductListView(
//                 store: Store(initialState: ProductListFeature.State()) {
//                     ProductListFeature()
//                 }
//             )
//         }
//     }
// }
```

---

## 3. Architectural Verification

- **Security — no plaintext tokens:** The `APIClient` includes a commented placeholder for attaching a Bearer token retrieved from the iOS Keychain. `UserDefaults` and `NSURLCache` are bypassed (`cachePolicy: .reloadIgnoringLocalCacheData`). CoreData stores no credentials, only product content.

- **Security — CoreData not encrypted by default:** For apps handling PII, add `NSPersistentStoreFileProtectionKey: FileProtectionType.complete` to the store description options and enable the Data Protection entitlement. The stack is designed to accept that addition with one line of configuration.

- **Immutability and unidirectional flow:** `State` is a value type (`struct`); the reducer is the only mutation site. `@ObservableState` tracks fine-grained changes for SwiftUI without manual `objectWillChange` calls. No view component mutates state directly.

- **Race condition — duplicate fetches:** `isAnyRequestInFlight` guard at the top of `loadMoreTriggered` and `onAppear` prevents a second in-flight request when the user scrolls to the bottom rapidly or double-triggers appear. Refresh cancels any active pagination effect via `.cancel(id: PaginationCancelID())` before starting.

- **Race condition — stale cache appends on refresh:** Pull-to-refresh deletes the CoreData store and rewrites with page 1 data before any subsequent pages are fetched, ensuring no orphaned rows from the previous session.

- **Offline resilience — instant cache render:** `onAppear` dispatches cache load before the network call. The list renders immediately with persisted data even if the device is offline. `isServingFromCache` drives a UI label so the user knows they are viewing stale data.

- **Offline resilience — graceful offline error:** When `URLError.notConnectedToInternet` is thrown and the cache is non-empty, the error message is softened to "Showing cached data" rather than a hard failure screen. When the cache is also empty, the full-screen error + retry UI appears.

- **Pagination correctness — de-duplication:** Appended items are filtered by `existingIDs` to handle overlapping cursor windows (a common backend edge case) without creating duplicate list entries.

- **Error handling — no empty catch blocks:** Every `.failure` arm either updates `state.errorMessage` for the user, logs via `os.log`, or both. The cache-save failure path is explicitly marked non-fatal with a log entry, not silently swallowed.

- **Resource cleanup — no leaks:** All async work runs inside TCA `Effect.run` closures, which TCA cancels automatically when the store is deallocated. There are no `AnyCancellable` sets, `Timer`s, or `StreamController`s that need manual teardown. The CoreData `backgroundContext` is owned by the `CoreDataStack` actor and lives for the app's lifetime, which is the correct scope for a shared persistence stack.

- **Testability:** Both `APIClient` and `CoreDataClient` provide `testValue` stubs conforming to `DependencyKey`. TCA's `TestStore` can inject these to drive the full reducer through every action path — cache miss, page 1 success, pagination, refresh, and all error branches — without hitting the network or disk.
