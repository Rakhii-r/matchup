# TCA Paginated Products Feature with CoreData Offline Support

## Architecture Overview

This implementation uses The Composable Architecture (TCA) with the following structure:

```
ProductsFeature/
├── ProductsFeature.swift         # Main reducer + State + Action
├── ProductsView.swift            # SwiftUI view
├── Models/
│   ├── Product.swift             # Domain model
│   └── ProductsResponse.swift    # API response model
├── Clients/
│   ├── ProductsAPIClient.swift   # REST API client (dependency)
│   └── ProductsPersistenceClient.swift  # CoreData client (dependency)
└── CoreData/
    ├── ProductsDataModel.xcdatamodeld
    └── ProductEntity+Extensions.swift
```

---

## 1. Domain Models

### `Models/Product.swift`

```swift
import Foundation

public struct Product: Equatable, Identifiable, Sendable {
    public let id: Int
    public let title: String
    public let description: String
    public let price: Double
    public let thumbnailURL: URL?
    public let category: String

    public init(
        id: Int,
        title: String,
        description: String,
        price: Double,
        thumbnailURL: URL?,
        category: String
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.price = price
        self.thumbnailURL = thumbnailURL
        self.category = category
    }
}
```

### `Models/ProductsResponse.swift`

```swift
import Foundation

struct ProductsResponse: Decodable {
    let products: [ProductDTO]
    let total: Int
    let skip: Int
    let limit: Int

    var hasMore: Bool {
        skip + products.count < total
    }
}

struct ProductDTO: Decodable {
    let id: Int
    let title: String
    let description: String
    let price: Double
    let thumbnail: String
    let category: String

    func toDomain() -> Product {
        Product(
            id: id,
            title: title,
            description: description,
            price: price,
            thumbnailURL: URL(string: thumbnail),
            category: category
        )
    }
}
```

---

## 2. Dependency Clients

### `Clients/ProductsAPIClient.swift`

```swift
import Dependencies
import Foundation

// MARK: - Interface

struct ProductsAPIClient: Sendable {
    var fetchProducts: @Sendable (_ page: Int, _ limit: Int) async throws -> ProductsResponse
}

// MARK: - Dependency Key

extension ProductsAPIClient: DependencyKey {
    static let liveValue = ProductsAPIClient(
        fetchProducts: { page, limit in
            let skip = page * limit
            var components = URLComponents(string: "https://dummyjson.com/products")!
            components.queryItems = [
                URLQueryItem(name: "limit", value: "\(limit)"),
                URLQueryItem(name: "skip", value: "\(skip)")
            ]

            let request = URLRequest(url: components.url!)
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  (200..<300).contains(httpResponse.statusCode) else {
                throw ProductsAPIError.invalidResponse
            }

            return try JSONDecoder().decode(ProductsResponse.self, from: data)
        }
    )

    static let testValue = ProductsAPIClient(
        fetchProducts: { _, _ in
            ProductsResponse(
                products: [
                    ProductDTO(
                        id: 1,
                        title: "Test Product",
                        description: "A test product",
                        price: 9.99,
                        thumbnail: "https://example.com/image.jpg",
                        category: "test"
                    )
                ],
                total: 1,
                skip: 0,
                limit: 20
            )
        }
    )
}

enum ProductsAPIError: LocalizedError {
    case invalidResponse
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "The server returned an invalid response."
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        }
    }
}

extension DependencyValues {
    var productsAPIClient: ProductsAPIClient {
        get { self[ProductsAPIClient.self] }
        set { self[ProductsAPIClient.self] = newValue }
    }
}
```

### `Clients/ProductsPersistenceClient.swift`

```swift
import CoreData
import Dependencies
import Foundation

// MARK: - Interface

struct ProductsPersistenceClient: Sendable {
    var saveProducts: @Sendable ([Product]) async throws -> Void
    var loadProducts: @Sendable () async throws -> [Product]
    var clearProducts: @Sendable () async throws -> Void
}

// MARK: - Dependency Key

extension ProductsPersistenceClient: DependencyKey {
    static let liveValue: ProductsPersistenceClient = {
        let container = PersistenceController.shared.container

        return ProductsPersistenceClient(
            saveProducts: { products in
                let context = container.newBackgroundContext()
                try await context.perform {
                    // Clear existing products before saving fresh data (page 0)
                    let fetchRequest: NSFetchRequest<NSFetchRequestResult> = ProductEntity.fetchRequest()
                    let deleteRequest = NSBatchDeleteRequest(fetchRequest: fetchRequest)
                    try context.execute(deleteRequest)

                    for product in products {
                        let entity = ProductEntity(context: context)
                        entity.id = Int64(product.id)
                        entity.title = product.title
                        entity.productDescription = product.description
                        entity.price = product.price
                        entity.thumbnailURL = product.thumbnailURL?.absoluteString
                        entity.category = product.category
                        entity.savedAt = Date()
                    }

                    try context.save()
                }
            },

            loadProducts: {
                let context = container.viewContext
                return try await context.perform {
                    let request: NSFetchRequest<ProductEntity> = ProductEntity.fetchRequest()
                    request.sortDescriptors = [NSSortDescriptor(key: "id", ascending: true)]
                    let entities = try context.fetch(request)
                    return entities.map { $0.toDomain() }
                }
            },

            clearProducts: {
                let context = container.newBackgroundContext()
                try await context.perform {
                    let fetchRequest: NSFetchRequest<NSFetchRequestResult> = ProductEntity.fetchRequest()
                    let deleteRequest = NSBatchDeleteRequest(fetchRequest: fetchRequest)
                    try context.execute(deleteRequest)
                    try context.save()
                }
            }
        )
    }()

    static let testValue = ProductsPersistenceClient(
        saveProducts: { _ in },
        loadProducts: { [] },
        clearProducts: { }
    )
}

extension DependencyValues {
    var productsPersistenceClient: ProductsPersistenceClient {
        get { self[ProductsPersistenceClient.self] }
        set { self[ProductsPersistenceClient.self] = newValue }
    }
}
```

---

## 3. CoreData Stack

### `CoreData/PersistenceController.swift`

```swift
import CoreData

final class PersistenceController: @unchecked Sendable {
    static let shared = PersistenceController()

    let container: NSPersistentContainer

    init(inMemory: Bool = false) {
        container = NSPersistentContainer(name: "ProductsDataModel")

        if inMemory {
            container.persistentStoreDescriptions.first?.url = URL(fileURLWithPath: "/dev/null")
        }

        container.loadPersistentStores { _, error in
            if let error {
                fatalError("CoreData store failed to load: \(error)")
            }
        }

        container.viewContext.automaticallyMergesChangesFromParent = true
        container.viewContext.mergePolicy = NSMergeByPropertyObjectTrumpMergePolicy
    }
}
```

### `CoreData/ProductEntity+Extensions.swift`

```swift
import CoreData
import Foundation

// Assumes ProductEntity has these attributes in the .xcdatamodeld:
// - id: Integer 64
// - title: String
// - productDescription: String
// - price: Double
// - thumbnailURL: String (optional)
// - category: String
// - savedAt: Date

extension ProductEntity {
    func toDomain() -> Product {
        Product(
            id: Int(id),
            title: title ?? "",
            description: productDescription ?? "",
            price: price,
            thumbnailURL: thumbnailURL.flatMap { URL(string: $0) },
            category: category ?? ""
        )
    }
}
```

### `CoreData/ProductsDataModel.xcdatamodeld` schema

Create an `.xcdatamodeld` file with an entity named **`ProductEntity`** and these attributes:

| Attribute            | Type        | Optional |
|----------------------|-------------|----------|
| `id`                 | Integer 64  | No       |
| `title`              | String      | No       |
| `productDescription` | String      | No       |
| `price`              | Double      | No       |
| `thumbnailURL`       | String      | Yes      |
| `category`           | String      | No       |
| `savedAt`            | Date        | No       |

---

## 4. The TCA Feature

### `ProductsFeature.swift`

```swift
import ComposableArchitecture
import Foundation

// MARK: - State

@Reducer
public struct ProductsFeature {

    // MARK: State

    @ObservableState
    public struct State: Equatable {
        // Data
        var products: [Product] = []
        var currentPage: Int = 0
        var hasMore: Bool = true
        let pageSize: Int = 20

        // Loading states
        var isLoading: Bool = false          // Initial load or refresh
        var isLoadingMore: Bool = false      // Pagination load
        var isRefreshing: Bool = false       // Pull-to-refresh

        // Error
        var errorMessage: String? = nil

        // Offline
        var isShowingCachedData: Bool = false

        public init() {}
    }

    // MARK: Action

    public enum Action: Equatable {
        // User Intent
        case onAppear
        case refreshTriggered
        case loadMoreTriggered
        case retryTapped

        // Internal
        case productsResponse(Result<ProductsResponse, ProductsError>)
        case cachedProductsLoaded([Product])
        case persistenceCompleted(Result<Void, ProductsError>)
    }

    // MARK: Error

    public enum ProductsError: LocalizedError, Equatable {
        case apiError(String)
        case persistenceError(String)
        case unknown

        public var errorDescription: String? {
            switch self {
            case .apiError(let msg): return msg
            case .persistenceError(let msg): return "Storage error: \(msg)"
            case .unknown: return "An unexpected error occurred."
            }
        }
    }

    // MARK: Dependencies

    @Dependency(\.productsAPIClient) var apiClient
    @Dependency(\.productsPersistenceClient) var persistenceClient

    // MARK: Reducer Body

    public var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {

            // MARK: - User Intent

            case .onAppear:
                guard !state.isLoading else { return .none }
                state.isLoading = true
                state.errorMessage = nil

                return .run { send in
                    // Load cached data first for instant display
                    let cached = (try? await persistenceClient.loadProducts()) ?? []
                    if !cached.isEmpty {
                        await send(.cachedProductsLoaded(cached))
                    }

                    // Then fetch fresh data from network
                    await send(fetchPage(0, pageSize: 20))
                }

            case .refreshTriggered:
                guard !state.isRefreshing else { return .none }
                state.isRefreshing = true
                state.errorMessage = nil

                return .run { [pageSize = state.pageSize] send in
                    await send(fetchPage(0, pageSize: pageSize))
                }

            case .loadMoreTriggered:
                guard !state.isLoadingMore,
                      !state.isLoading,
                      !state.isRefreshing,
                      state.hasMore else { return .none }

                state.isLoadingMore = true
                let nextPage = state.currentPage + 1

                return .run { [pageSize = state.pageSize] send in
                    await send(fetchPage(nextPage, pageSize: pageSize))
                }

            case .retryTapped:
                state.isLoading = true
                state.errorMessage = nil

                return .run { [pageSize = state.pageSize] send in
                    await send(fetchPage(0, pageSize: pageSize))
                }

            // MARK: - Internal Responses

            case .cachedProductsLoaded(let cached):
                // Only apply cached data if we haven't already loaded fresh data
                if state.isLoading || state.isRefreshing {
                    state.products = cached
                    state.isShowingCachedData = true
                }
                return .none

            case .productsResponse(.success(let response)):
                let newProducts = response.products.map { $0.toDomain() }

                if state.isRefreshing || state.currentPage == 0 {
                    // Replace all products on refresh or first page
                    state.products = newProducts
                    state.currentPage = 0
                } else {
                    // Append for pagination
                    state.products.append(contentsOf: newProducts)
                    state.currentPage += 1
                }

                state.hasMore = response.hasMore
                state.isLoading = false
                state.isLoadingMore = false
                state.isRefreshing = false
                state.errorMessage = nil
                state.isShowingCachedData = false

                // Persist first page as the offline cache
                let productsToCache = state.products
                return .run { send in
                    await send(.persistenceCompleted(
                        Result {
                            try await persistenceClient.saveProducts(productsToCache)
                        }.mapError { .persistenceError($0.localizedDescription) }
                    ))
                }

            case .productsResponse(.failure(let error)):
                state.isLoading = false
                state.isLoadingMore = false
                state.isRefreshing = false
                state.errorMessage = error.errorDescription

                // Keep showing cached data if available
                if !state.products.isEmpty {
                    state.isShowingCachedData = true
                }
                return .none

            case .persistenceCompleted:
                // Silently handle persistence result; could log errors in production
                return .none
            }
        }
    }

    // MARK: - Private Helpers

    private func fetchPage(_ page: Int, pageSize: Int) async -> Action {
        await Action.productsResponse(
            Result {
                try await apiClient.fetchProducts(page, pageSize)
            }.mapError { error in
                ProductsError.apiError(
                    (error as? LocalizedError)?.errorDescription
                    ?? error.localizedDescription
                )
            }
        )
    }
}
```

---

## 5. SwiftUI View

### `ProductsView.swift`

```swift
import ComposableArchitecture
import SwiftUI

// MARK: - Main View

public struct ProductsView: View {
    @Bindable var store: StoreOf<ProductsFeature>

    public init(store: StoreOf<ProductsFeature>) {
        self.store = store
    }

    public var body: some View {
        NavigationStack {
            Group {
                if store.isLoading && store.products.isEmpty {
                    loadingView
                } else if let error = store.errorMessage, store.products.isEmpty {
                    errorView(message: error)
                } else {
                    productList
                }
            }
            .navigationTitle("Products")
            .toolbar {
                if store.isShowingCachedData {
                    ToolbarItem(placement: .topBarTrailing) {
                        cachedDataBadge
                    }
                }
            }
        }
        .task {
            store.send(.onAppear)
        }
    }

    // MARK: - Subviews

    private var productList: some View {
        List {
            // Offline banner
            if store.isShowingCachedData && store.errorMessage != nil {
                offlineBanner
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }

            // Product rows
            ForEach(store.products) { product in
                ProductRowView(product: product)
                    .onAppear {
                        // Trigger load more when last item appears
                        if product.id == store.products.last?.id {
                            store.send(.loadMoreTriggered)
                        }
                    }
            }

            // Pagination footer
            if store.isLoadingMore {
                HStack {
                    Spacer()
                    ProgressView()
                        .padding()
                    Spacer()
                }
                .listRowSeparator(.hidden)
            } else if !store.hasMore && !store.products.isEmpty {
                Text("All products loaded")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .listRowSeparator(.hidden)
            }

            // Network error banner at bottom (for pagination errors)
            if let error = store.errorMessage, !store.products.isEmpty {
                errorBanner(message: error)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .refreshable {
            // SwiftUI's refreshable works with async — send action and wait
            await withCheckedContinuation { continuation in
                store.send(.refreshTriggered)
                // Resume after a brief period; TCA state change will update UI
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    continuation.resume()
                }
            }
        }
    }

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.5)
            Text("Loading products...")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorView(message: String) -> some View {
        VStack(spacing: 20) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 60))
                .foregroundStyle(.secondary)

            Text("Something went wrong")
                .font(.title2)
                .fontWeight(.semibold)

            Text(message)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Button(action: { store.send(.retryTapped) }) {
                Label("Try Again", systemImage: "arrow.clockwise")
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private var offlineBanner: some View {
        HStack {
            Image(systemName: "wifi.slash")
            Text("Showing cached data — you're offline")
                .font(.caption)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(Color.orange)
    }

    private func errorBanner(message: String) -> some View {
        VStack(spacing: 8) {
            Text(message)
                .font(.caption)
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)

            Button("Retry") {
                store.send(.retryTapped)
            }
            .font(.caption.bold())
            .foregroundStyle(.white)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(Color.red.gradient)
    }

    private var cachedDataBadge: some View {
        Image(systemName: "clock.arrow.circlepath")
            .foregroundStyle(.orange)
            .help("Showing cached data")
    }
}

// MARK: - Product Row

struct ProductRowView: View {
    let product: Product

    var body: some View {
        HStack(spacing: 12) {
            // Thumbnail
            AsyncImage(url: product.thumbnailURL) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                case .failure:
                    placeholderImage
                case .empty:
                    ProgressView()
                @unknown default:
                    placeholderImage
                }
            }
            .frame(width: 64, height: 64)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .background(Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 8))

            // Details
            VStack(alignment: .leading, spacing: 4) {
                Text(product.title)
                    .font(.headline)
                    .lineLimit(2)

                Text(product.category.capitalized)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text(product.price, format: .currency(code: "USD"))
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(.green)
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }

    private var placeholderImage: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Color(.systemGray5))
            .overlay(
                Image(systemName: "photo")
                    .foregroundStyle(.secondary)
            )
    }
}

// MARK: - Preview

#Preview {
    ProductsView(
        store: Store(initialState: ProductsFeature.State()) {
            ProductsFeature()
        } withDependencies: {
            $0.productsAPIClient = .testValue
            $0.productsPersistenceClient = .testValue
        }
    )
}
```

---

## 6. Tests

### `ProductsFeatureTests.swift`

```swift
import ComposableArchitecture
import XCTest
@testable import YourApp

@MainActor
final class ProductsFeatureTests: XCTestCase {

    // MARK: - Helpers

    func makeStore(
        state: ProductsFeature.State = .init(),
        products: [Product] = [Product(id: 1, title: "Test", description: "Desc", price: 9.99, thumbnailURL: nil, category: "test")],
        cachedProducts: [Product] = []
    ) -> TestStore<ProductsFeature.State, ProductsFeature.Action> {
        let response = ProductsResponse(
            products: products.map {
                ProductDTO(id: $0.id, title: $0.title, description: $0.description, price: $0.price, thumbnail: "", category: $0.category)
            },
            total: products.count,
            skip: 0,
            limit: 20
        )

        return TestStore(initialState: state) {
            ProductsFeature()
        } withDependencies: {
            $0.productsAPIClient.fetchProducts = { _, _ in response }
            $0.productsPersistenceClient.saveProducts = { _ in }
            $0.productsPersistenceClient.loadProducts = { cachedProducts }
            $0.productsPersistenceClient.clearProducts = { }
        }
    }

    // MARK: - Tests

    func testOnAppear_withNoCachedData_loadsFromNetwork() async {
        let store = makeStore()

        await store.send(.onAppear) {
            $0.isLoading = true
            $0.errorMessage = nil
        }

        // Cached data (empty, so no .cachedProductsLoaded action)
        await store.receive(.productsResponse(.success(...))) {
            $0.products = [Product(id: 1, title: "Test", description: "Desc", price: 9.99, thumbnailURL: nil, category: "test")]
            $0.isLoading = false
            $0.isShowingCachedData = false
            $0.hasMore = false
        }

        await store.receive(.persistenceCompleted(.success(())))
    }

    func testOnAppear_withCachedData_showsCacheWhileLoading() async {
        let cached = [Product(id: 99, title: "Cached", description: "", price: 1, thumbnailURL: nil, category: "old")]
        let store = makeStore(cachedProducts: cached)

        await store.send(.onAppear) {
            $0.isLoading = true
        }

        await store.receive(.cachedProductsLoaded(cached)) {
            $0.products = cached
            $0.isShowingCachedData = true
        }

        await store.receive(.productsResponse(.success(...))) {
            $0.products = [/* fresh products */]
            $0.isLoading = false
            $0.isShowingCachedData = false
        }

        await store.receive(.persistenceCompleted(.success(())))
    }

    func testNetworkError_showsErrorMessage() async {
        let store = TestStore(initialState: ProductsFeature.State()) {
            ProductsFeature()
        } withDependencies: {
            $0.productsAPIClient.fetchProducts = { _, _ in
                throw URLError(.notConnectedToInternet)
            }
            $0.productsPersistenceClient.loadProducts = { [] }
            $0.productsPersistenceClient.saveProducts = { _ in }
        }

        await store.send(.onAppear) { $0.isLoading = true }
        await store.receive(.productsResponse(.failure(.apiError("The operation couldn't be completed. (NSURLErrorDomain error -1009.)")))) {
            $0.isLoading = false
            $0.errorMessage = "The operation couldn't be completed. (NSURLErrorDomain error -1009.)"
        }
    }

    func testRetry_clearsErrorAndFetchesAgain() async {
        var state = ProductsFeature.State()
        state.errorMessage = "Network error"
        let store = makeStore(state: state)

        await store.send(.retryTapped) {
            $0.isLoading = true
            $0.errorMessage = nil
        }

        await store.receive(.productsResponse(.success(...))) {
            $0.isLoading = false
            $0.errorMessage = nil
        }

        await store.receive(.persistenceCompleted(.success(())))
    }

    func testPullToRefresh_replacesProducts() async {
        var state = ProductsFeature.State()
        state.products = [Product(id: 99, title: "Old", description: "", price: 0, thumbnailURL: nil, category: "")]
        state.currentPage = 2

        let store = makeStore(state: state)

        await store.send(.refreshTriggered) { $0.isRefreshing = true }

        await store.receive(.productsResponse(.success(...))) {
            $0.products = [Product(id: 1, title: "Test", description: "Desc", price: 9.99, thumbnailURL: nil, category: "test")]
            $0.currentPage = 0
            $0.isRefreshing = false
        }

        await store.receive(.persistenceCompleted(.success(())))
    }

    func testLoadMore_appendsProducts() async {
        var state = ProductsFeature.State()
        state.products = [Product(id: 1, title: "Existing", description: "", price: 0, thumbnailURL: nil, category: "")]
        state.currentPage = 0
        state.hasMore = true

        // Return a page-2 product
        let page2Product = Product(id: 2, title: "Page2", description: "", price: 5, thumbnailURL: nil, category: "")
        let store = makeStore(state: state, products: [page2Product])

        await store.send(.loadMoreTriggered) { $0.isLoadingMore = true }

        await store.receive(.productsResponse(.success(...))) {
            $0.products = [
                Product(id: 1, title: "Existing", description: "", price: 0, thumbnailURL: nil, category: ""),
                page2Product
            ]
            $0.currentPage = 1
            $0.isLoadingMore = false
        }

        await store.receive(.persistenceCompleted(.success(())))
    }
}
```

> **Note:** Replace `...` in `receive` calls with the actual `ProductsResponse` value matching your test setup. TCA's `TestStore` requires exact value matching.

---

## 7. App Entry Point

### `YourApp.swift`

```swift
import ComposableArchitecture
import SwiftUI

@main
struct YourApp: App {
    var body: some Scene {
        WindowGroup {
            ProductsView(
                store: Store(initialState: ProductsFeature.State()) {
                    ProductsFeature()
                }
            )
        }
    }
}
```

---

## 8. Package Dependencies

In your `Package.swift` or Xcode package dependencies, add:

```swift
// Package.swift
dependencies: [
    .package(
        url: "https://github.com/pointfreeco/swift-composable-architecture",
        from: "1.10.0"
    )
],
targets: [
    .target(
        name: "YourApp",
        dependencies: [
            .product(name: "ComposableArchitecture", package: "swift-composable-architecture")
        ]
    )
]
```

---

## Key Design Decisions

### State Management
- **`isLoading`** covers initial load and retry (products list is empty, full-screen spinner shown).
- **`isLoadingMore`** covers pagination (spinner at list bottom, existing products visible).
- **`isRefreshing`** covers pull-to-refresh (system refresh control, replaces products on success).
- These three flags are mutually exclusive in the guard conditions.

### Offline Strategy
- On `.onAppear`, cached products are loaded first for instant display while the network request is in flight.
- On network success, the full current product list (not just new items) is saved to CoreData.
- Only the first page data is persisted — pagination data is considered ephemeral.
- `isShowingCachedData` drives the offline banner so the user knows data may be stale.

### Pagination
- Uses cursor-based pagination with `skip`/`limit` pattern (compatible with DummyJSON and many REST APIs).
- The `hasMore` flag is derived from the API response (`total > skip + count`).
- Load-more is triggered when the last list item appears on screen via `.onAppear`.
- Duplicate trigger prevention via the `isLoadingMore` guard.

### Error Handling
- **Empty state errors**: Full-screen error view with retry button.
- **Pagination errors**: Red banner at the bottom of the list with a retry option.
- **Offline with cache**: Orange banner indicating stale data, list remains usable.

### TCA Conventions
- Uses `@Reducer` macro (TCA 1.x).
- Uses `@ObservableState` for automatic observation (no `WithViewStore` needed).
- Side effects are all captured in `.run` closures returning `Effect`.
- Dependencies injected via `@Dependency` — fully testable with `withDependencies`.
- `ProductsError` is `Equatable` so TCA `TestStore` can assert on `.failure` cases.
