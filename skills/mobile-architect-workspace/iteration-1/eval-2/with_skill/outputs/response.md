# Flutter + Isar: Encrypted Fields, Schema Design & Clean Data Layer

---

## 1. Architectural Blueprint

The architecture follows Clean Architecture with three strict layers: **Presentation** (Flutter widgets + Cubits), **Domain** (pure Dart entities, repository interfaces, use cases), and **Data** (Isar-backed repository implementations + encryption service). Isar stores user profiles in plaintext — only non-sensitive fields — while sensitive financial records have their payload AES-256 encrypted before they ever reach the database. The encryption key is derived from `flutter_secure_storage`, which delegates to the platform Keychain (iOS) or Keystore-backed EncryptedSharedPreferences (Android), so the key never lives in memory longer than necessary and never touches disk unprotected.

Isar itself does not offer column-level encryption, so the pattern used here is **application-layer field encryption**: a dedicated `EncryptionService` wraps `encrypt` (AES-256/CBC + PKCS7 with a random IV per record) and is injected via `get_it`. The `FinancialRecord` Isar collection stores only the ciphertext blob and a per-record IV; no sensitive value ever reaches the Isar buffer unencrypted. Repository implementations in the data layer handle the encrypt-on-write / decrypt-on-read cycle, keeping this concern invisible to the domain and presentation layers.

State is managed with **Cubit** (a simplified BLoC), with immutable state classes. The UI observes `BlocBuilder`; it never calls the repository directly. This design means you can swap Isar for a remote API tomorrow without touching a single widget.

---

## 2. The Implementation

### File structure

```
lib/
  core/
    di/
      injection.dart
    encryption/
      encryption_service.dart
    error/
      failures.dart
  domain/
    entities/
      user_profile.dart
      financial_record.dart
    repositories/
      user_profile_repository.dart
      financial_record_repository.dart
    usecases/
      get_user_profile.dart
      save_financial_record.dart
  data/
    models/
      user_profile_isar.dart        # Isar collection
      financial_record_isar.dart    # Isar collection
    repositories/
      user_profile_repository_impl.dart
      financial_record_repository_impl.dart
    datasources/
      local/
        isar_datasource.dart
  presentation/
    profile/
      cubit/
        profile_cubit.dart
        profile_state.dart
      view/
        profile_page.dart
```

---

### `pubspec.yaml` dependencies

```yaml
dependencies:
  flutter:
    sdk: flutter
  isar: ^3.1.0
  isar_flutter_libs: ^3.1.0   # includes Isar native binaries
  flutter_secure_storage: ^9.0.0
  encrypt: ^5.0.3
  get_it: ^7.6.0
  injectable: ^2.3.2
  flutter_bloc: ^8.1.4
  dartz: ^0.10.1               # Either for error handling
  equatable: ^2.0.5

dev_dependencies:
  isar_generator: ^3.1.0
  build_runner: ^2.4.8
  injectable_generator: ^2.4.1
```

---

### `lib/core/encryption/encryption_service.dart`

```dart
import 'dart:convert';
import 'dart:typed_data';

import 'package:encrypt/encrypt.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:injectable/injectable.dart';

/// Wraps AES-256/CBC encryption backed by a platform-secured key.
/// The key is generated once, stored in Keychain/Keystore via
/// flutter_secure_storage, and reloaded on subsequent launches.
@lazySingleton
class EncryptionService {
  static const _keyAlias = 'app_aes_key_v1';

  final FlutterSecureStorage _secureStorage;

  late final Key _key;
  late final Encrypter _encrypter;

  EncryptionService(this._secureStorage);

  /// Must be called once during app startup (before DI graph is used).
  Future<void> initialize() async {
    final stored = await _secureStorage.read(key: _keyAlias);
    if (stored != null) {
      _key = Key(base64Decode(stored));
    } else {
      _key = Key.fromSecureRandom(32); // 256-bit
      await _secureStorage.write(
        key: _keyAlias,
        value: base64Encode(_key.bytes),
      );
    }
    _encrypter = Encrypter(AES(_key, mode: AESMode.cbc, padding: 'PKCS7'));
  }

  /// Encrypts [plaintext] and returns a record containing the ciphertext
  /// and the random IV used. Both must be persisted together.
  ({String ciphertext, String iv}) encrypt(String plaintext) {
    final iv = IV.fromSecureRandom(16);
    final encrypted = _encrypter.encrypt(plaintext, iv: iv);
    return (
      ciphertext: encrypted.base64,
      iv: base64Encode(iv.bytes),
    );
  }

  /// Decrypts [ciphertext] using the given [ivBase64].
  /// Throws [EncryptionException] on any failure — never returns null.
  String decrypt(String ciphertext, String ivBase64) {
    try {
      final iv = IV(base64Decode(ivBase64));
      return _encrypter.decrypt64(ciphertext, iv: iv);
    } catch (e) {
      throw EncryptionException('Decryption failed: $e');
    }
  }
}

class EncryptionException implements Exception {
  final String message;
  const EncryptionException(this.message);

  @override
  String toString() => 'EncryptionException: $message';
}
```

---

### `lib/core/error/failures.dart`

```dart
import 'package:equatable/equatable.dart';

abstract class Failure extends Equatable {
  final String message;
  const Failure(this.message);

  @override
  List<Object> get props => [message];
}

class DatabaseFailure extends Failure {
  const DatabaseFailure(super.message);
}

class EncryptionFailure extends Failure {
  const EncryptionFailure(super.message);
}

class NotFoundFailure extends Failure {
  const NotFoundFailure(super.message);
}
```

---

### `lib/domain/entities/user_profile.dart`

```dart
import 'package:equatable/equatable.dart';

/// Pure domain entity — zero framework imports.
class UserProfile extends Equatable {
  final String id;
  final String displayName;
  final String email;
  final DateTime createdAt;

  const UserProfile({
    required this.id,
    required this.displayName,
    required this.email,
    required this.createdAt,
  });

  @override
  List<Object> get props => [id, displayName, email, createdAt];
}
```

---

### `lib/domain/entities/financial_record.dart`

```dart
import 'package:equatable/equatable.dart';

/// Domain entity. Sensitive fields (accountNumber, amount, notes)
/// are plaintext here — the encryption boundary is at the data layer.
class FinancialRecord extends Equatable {
  final String id;
  final String userId;
  final String accountNumber; // sensitive
  final double amount;        // sensitive
  final String notes;         // sensitive
  final DateTime recordedAt;

  const FinancialRecord({
    required this.id,
    required this.userId,
    required this.accountNumber,
    required this.amount,
    required this.notes,
    required this.recordedAt,
  });

  @override
  List<Object> get props => [id, userId, accountNumber, amount, notes, recordedAt];
}
```

---

### `lib/domain/repositories/user_profile_repository.dart`

```dart
import 'package:dartz/dartz.dart';
import '../entities/user_profile.dart';
import '../../core/error/failures.dart';

abstract interface class UserProfileRepository {
  Future<Either<Failure, UserProfile>> getProfile(String userId);
  Future<Either<Failure, Unit>> saveProfile(UserProfile profile);
}
```

---

### `lib/domain/repositories/financial_record_repository.dart`

```dart
import 'package:dartz/dartz.dart';
import '../entities/financial_record.dart';
import '../../core/error/failures.dart';

abstract interface class FinancialRecordRepository {
  Future<Either<Failure, List<FinancialRecord>>> getRecordsForUser(String userId);
  Future<Either<Failure, Unit>> saveRecord(FinancialRecord record);
  Future<Either<Failure, Unit>> deleteRecord(String recordId);
}
```

---

### `lib/domain/usecases/get_user_profile.dart`

```dart
import 'package:dartz/dartz.dart';
import 'package:injectable/injectable.dart';
import '../entities/user_profile.dart';
import '../repositories/user_profile_repository.dart';
import '../../core/error/failures.dart';

@injectable
class GetUserProfile {
  final UserProfileRepository _repository;

  const GetUserProfile(this._repository);

  Future<Either<Failure, UserProfile>> call(String userId) =>
      _repository.getProfile(userId);
}
```

---

### `lib/domain/usecases/save_financial_record.dart`

```dart
import 'package:dartz/dartz.dart';
import 'package:injectable/injectable.dart';
import '../entities/financial_record.dart';
import '../repositories/financial_record_repository.dart';
import '../../core/error/failures.dart';

@injectable
class SaveFinancialRecord {
  final FinancialRecordRepository _repository;

  const SaveFinancialRecord(this._repository);

  Future<Either<Failure, Unit>> call(FinancialRecord record) =>
      _repository.saveRecord(record);
}
```

---

### `lib/data/models/user_profile_isar.dart`

```dart
import 'package:isar/isar.dart';

part 'user_profile_isar.g.dart';

/// Isar collection for non-sensitive user profile data.
/// No encrypted fields needed here — adjust if you add sensitive fields.
@collection
class UserProfileIsar {
  Id get isarId => fastHash(id);

  @Index(unique: true)
  late String id;

  late String displayName;
  late String email;
  late DateTime createdAt;
}

/// Stable hash so the Isar Id is deterministic from the domain id string.
int fastHash(String string) {
  var hash = 0xcbf29ce484222325;
  for (var i = 0; i < string.length; i++) {
    final codeUnit = string.codeUnitAt(i);
    hash ^= codeUnit >> 8;
    hash *= 0x100000001b3;
    hash ^= codeUnit & 0xFF;
    hash *= 0x100000001b3;
  }
  return hash;
}
```

---

### `lib/data/models/financial_record_isar.dart`

```dart
import 'package:isar/isar.dart';
import 'user_profile_isar.dart' show fastHash;

part 'financial_record_isar.g.dart';

/// Isar collection for financial records.
///
/// Sensitive fields (accountNumber, amount, notes) are stored as
/// AES-256 ciphertext. Each field has a paired IV field.
///
/// NEVER add a plaintext accountNumber, amount, or notes field here.
@collection
class FinancialRecordIsar {
  Id get isarId => fastHash(id);

  @Index(unique: true)
  late String id;

  @Index()
  late String userId;

  // --- Encrypted sensitive fields ---
  late String encryptedAccountNumber;
  late String ivAccountNumber;

  late String encryptedAmount;      // double serialized as string before encryption
  late String ivAmount;

  late String encryptedNotes;
  late String ivNotes;
  // ----------------------------------

  late DateTime recordedAt;
}
```

---

### `lib/data/datasources/local/isar_datasource.dart`

```dart
import 'package:injectable/injectable.dart';
import 'package:isar/isar.dart';
import '../../models/user_profile_isar.dart';
import '../../models/financial_record_isar.dart';

/// Single point of Isar initialization — registered as a lazySingleton
/// so the database is opened exactly once per process lifetime.
@lazySingleton
class IsarDatasource {
  late final Isar _isar;

  Future<void> initialize() async {
    _isar = await Isar.open(
      [UserProfileIsarSchema, FinancialRecordIsarSchema],
      // name: 'default',   // use a named instance for multi-user scenarios
    );
  }

  IsarCollection<UserProfileIsar> get userProfiles => _isar.userProfileIsars;
  IsarCollection<FinancialRecordIsar> get financialRecords =>
      _isar.financialRecordIsars;

  /// Exposed for write transactions spanning multiple collections.
  Future<T> writeTxn<T>(Future<T> Function() callback) =>
      _isar.writeTxn(callback);
}
```

---

### `lib/data/repositories/user_profile_repository_impl.dart`

```dart
import 'package:dartz/dartz.dart';
import 'package:injectable/injectable.dart';
import 'package:isar/isar.dart';

import '../../core/error/failures.dart';
import '../../domain/entities/user_profile.dart';
import '../../domain/repositories/user_profile_repository.dart';
import '../datasources/local/isar_datasource.dart';
import '../models/user_profile_isar.dart';

@LazySingleton(as: UserProfileRepository)
class UserProfileRepositoryImpl implements UserProfileRepository {
  final IsarDatasource _db;

  const UserProfileRepositoryImpl(this._db);

  @override
  Future<Either<Failure, UserProfile>> getProfile(String userId) async {
    try {
      final record = await _db.userProfiles
          .filter()
          .idEqualTo(userId)
          .findFirst();

      if (record == null) {
        return const Left(NotFoundFailure('User profile not found'));
      }

      return Right(_toDomain(record));
    } on IsarError catch (e) {
      return Left(DatabaseFailure('Isar read error: ${e.message}'));
    }
  }

  @override
  Future<Either<Failure, Unit>> saveProfile(UserProfile profile) async {
    try {
      final model = _toModel(profile);
      await _db.writeTxn(() => _db.userProfiles.put(model));
      return const Right(unit);
    } on IsarError catch (e) {
      return Left(DatabaseFailure('Isar write error: ${e.message}'));
    }
  }

  // --- Mappers ---

  UserProfile _toDomain(UserProfileIsar m) => UserProfile(
        id: m.id,
        displayName: m.displayName,
        email: m.email,
        createdAt: m.createdAt,
      );

  UserProfileIsar _toModel(UserProfile e) => UserProfileIsar()
    ..id = e.id
    ..displayName = e.displayName
    ..email = e.email
    ..createdAt = e.createdAt;
}
```

---

### `lib/data/repositories/financial_record_repository_impl.dart`

```dart
import 'package:dartz/dartz.dart';
import 'package:injectable/injectable.dart';
import 'package:isar/isar.dart';

import '../../core/encryption/encryption_service.dart';
import '../../core/error/failures.dart';
import '../../domain/entities/financial_record.dart';
import '../../domain/repositories/financial_record_repository.dart';
import '../datasources/local/isar_datasource.dart';
import '../models/financial_record_isar.dart';

@LazySingleton(as: FinancialRecordRepository)
class FinancialRecordRepositoryImpl implements FinancialRecordRepository {
  final IsarDatasource _db;
  final EncryptionService _enc;

  const FinancialRecordRepositoryImpl(this._db, this._enc);

  @override
  Future<Either<Failure, List<FinancialRecord>>> getRecordsForUser(
    String userId,
  ) async {
    try {
      final records = await _db.financialRecords
          .filter()
          .userIdEqualTo(userId)
          .sortByRecordedAtDesc()
          .findAll();

      final domain = <FinancialRecord>[];
      for (final r in records) {
        try {
          domain.add(_toDomain(r));
        } on EncryptionException catch (e) {
          // Log and skip a corrupted record rather than crashing the whole list.
          // In production, forward to your crash reporter (e.g. Sentry).
          assert(() {
            // ignore: avoid_print
            print('[FinancialRecordRepo] Skipping record ${r.id}: $e');
            return true;
          }());
        }
      }
      return Right(domain);
    } on IsarError catch (e) {
      return Left(DatabaseFailure('Isar read error: ${e.message}'));
    }
  }

  @override
  Future<Either<Failure, Unit>> saveRecord(FinancialRecord record) async {
    try {
      final model = _toModel(record);
      await _db.writeTxn(() => _db.financialRecords.put(model));
      return const Right(unit);
    } on IsarError catch (e) {
      return Left(DatabaseFailure('Isar write error: ${e.message}'));
    } on EncryptionException catch (e) {
      return Left(EncryptionFailure(e.message));
    }
  }

  @override
  Future<Either<Failure, Unit>> deleteRecord(String recordId) async {
    try {
      await _db.writeTxn(
        () => _db.financialRecords.deleteByIndex('id', [recordId]),
      );
      return const Right(unit);
    } on IsarError catch (e) {
      return Left(DatabaseFailure('Isar delete error: ${e.message}'));
    }
  }

  // --- Encrypt-on-write ---

  FinancialRecordIsar _toModel(FinancialRecord e) {
    final accountEnc = _enc.encrypt(e.accountNumber);
    final amountEnc = _enc.encrypt(e.amount.toString());
    final notesEnc = _enc.encrypt(e.notes);

    return FinancialRecordIsar()
      ..id = e.id
      ..userId = e.userId
      ..encryptedAccountNumber = accountEnc.ciphertext
      ..ivAccountNumber = accountEnc.iv
      ..encryptedAmount = amountEnc.ciphertext
      ..ivAmount = amountEnc.iv
      ..encryptedNotes = notesEnc.ciphertext
      ..ivNotes = notesEnc.iv
      ..recordedAt = e.recordedAt;
  }

  // --- Decrypt-on-read ---

  FinancialRecord _toDomain(FinancialRecordIsar m) => FinancialRecord(
        id: m.id,
        userId: m.userId,
        accountNumber: _enc.decrypt(m.encryptedAccountNumber, m.ivAccountNumber),
        amount: double.parse(_enc.decrypt(m.encryptedAmount, m.ivAmount)),
        notes: _enc.decrypt(m.encryptedNotes, m.ivNotes),
        recordedAt: m.recordedAt,
      );
}
```

---

### `lib/presentation/profile/cubit/profile_state.dart`

```dart
import 'package:equatable/equatable.dart';
import '../../../domain/entities/user_profile.dart';
import '../../../domain/entities/financial_record.dart';

enum ProfileStatus { initial, loading, loaded, error }

final class ProfileState extends Equatable {
  final ProfileStatus status;
  final UserProfile? profile;
  final List<FinancialRecord> financialRecords;
  final String? errorMessage;

  const ProfileState({
    this.status = ProfileStatus.initial,
    this.profile,
    this.financialRecords = const [],
    this.errorMessage,
  });

  ProfileState copyWith({
    ProfileStatus? status,
    UserProfile? profile,
    List<FinancialRecord>? financialRecords,
    String? errorMessage,
  }) =>
      ProfileState(
        status: status ?? this.status,
        profile: profile ?? this.profile,
        financialRecords: financialRecords ?? this.financialRecords,
        errorMessage: errorMessage ?? this.errorMessage,
      );

  @override
  List<Object?> get props => [status, profile, financialRecords, errorMessage];
}
```

---

### `lib/presentation/profile/cubit/profile_cubit.dart`

```dart
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:injectable/injectable.dart';
import '../../../domain/usecases/get_user_profile.dart';
import '../../../domain/usecases/save_financial_record.dart';
import '../../../domain/entities/financial_record.dart';
import 'profile_state.dart';

@injectable
class ProfileCubit extends Cubit<ProfileState> {
  final GetUserProfile _getProfile;
  final SaveFinancialRecord _saveRecord;

  ProfileCubit(this._getProfile, this._saveRecord)
      : super(const ProfileState());

  Future<void> loadProfile(String userId) async {
    emit(state.copyWith(status: ProfileStatus.loading));

    final result = await _getProfile(userId);

    result.fold(
      (failure) => emit(
        state.copyWith(
          status: ProfileStatus.error,
          errorMessage: failure.message,
        ),
      ),
      (profile) => emit(
        state.copyWith(status: ProfileStatus.loaded, profile: profile),
      ),
    );
  }

  Future<void> addFinancialRecord(FinancialRecord record) async {
    final result = await _saveRecord(record);

    result.fold(
      (failure) => emit(
        state.copyWith(
          status: ProfileStatus.error,
          errorMessage: failure.message,
        ),
      ),
      (_) {
        // Optimistic local update — append to existing list.
        final updated = List<FinancialRecord>.from(state.financialRecords)
          ..add(record);
        emit(state.copyWith(financialRecords: updated));
      },
    );
  }
}
```

---

### `lib/presentation/profile/view/profile_page.dart`

```dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../cubit/profile_cubit.dart';
import '../cubit/profile_state.dart';

class ProfilePage extends StatefulWidget {
  final String userId;
  const ProfilePage({required this.userId, super.key});

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  @override
  void initState() {
    super.initState();
    // Use addPostFrameCallback to avoid calling Cubit during build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ProfileCubit>().loadProfile(widget.userId);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: BlocBuilder<ProfileCubit, ProfileState>(
        builder: (context, state) => switch (state.status) {
          ProfileStatus.initial || ProfileStatus.loading =>
            const Center(child: CircularProgressIndicator()),
          ProfileStatus.error => Center(
              child: Text(
                state.errorMessage ?? 'Unknown error',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          ProfileStatus.loaded => _LoadedBody(state: state),
        },
      ),
    );
  }
}

class _LoadedBody extends StatelessWidget {
  final ProfileState state;
  const _LoadedBody({required this.state});

  @override
  Widget build(BuildContext context) {
    final profile = state.profile!;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(profile.displayName,
            style: Theme.of(context).textTheme.headlineMedium),
        Text(profile.email),
        const Divider(height: 32),
        const Text('Financial Records',
            style: TextStyle(fontWeight: FontWeight.bold)),
        // Financial records are rendered here. The domain entity fields
        // are already decrypted by the data layer — widgets have no
        // awareness of encryption at all.
        ...state.financialRecords.map(
          (r) => ListTile(
            title: Text('••••${r.accountNumber.substring(r.accountNumber.length - 4)}'),
            subtitle: Text(r.notes),
            trailing: Text('\$${r.amount.toStringAsFixed(2)}'),
          ),
        ),
      ],
    );
  }
}
```

---

### `lib/core/di/injection.dart`

```dart
import 'package:get_it/get_it.dart';
import 'package:injectable/injectable.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'injection.config.dart'; // generated by injectable_generator

final getIt = GetIt.instance;

@InjectableInit()
Future<void> configureDependencies() async {
  // Register FlutterSecureStorage manually (not injectable-annotated).
  getIt.registerLazySingleton<FlutterSecureStorage>(
    () => const FlutterSecureStorage(
      aOptions: AndroidOptions(encryptedSharedPreferences: true),
      iOptions: IOSOptions(
        accessibility: KeychainAccessibility.first_unlock_this_device,
      ),
    ),
  );

  getIt.init(); // registers all @injectable / @lazySingleton annotated types

  // Initialize singletons that require async setup.
  await getIt<EncryptionService>().initialize();
  await getIt<IsarDatasource>().initialize();
}
```

---

### `lib/main.dart`

```dart
import 'package:flutter/material.dart';
import 'core/di/injection.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await configureDependencies();
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Secure Finance App',
      home: BlocProvider(
        create: (_) => getIt<ProfileCubit>(),
        child: ProfilePage(userId: 'current-user-id'),
      ),
    );
  }
}
```

---

## 3. Architectural Verification

- **AES-256 encryption at rest:** Every sensitive field (`accountNumber`, `amount`, `notes`) is encrypted with a fresh random IV before the Isar write call. The key never leaves `flutter_secure_storage`; it is loaded into memory only during `EncryptionService.initialize()` and held in a `late final` field for the process lifetime.

- **Platform key security:** `AndroidOptions(encryptedSharedPreferences: true)` delegates to Android Keystore-backed EncryptedSharedPreferences. `IOSOptions(accessibility: first_unlock_this_device)` restricts Keychain access to after the first device unlock — preventing data access when the device is off or just rebooted without a pin entry.

- **No sensitive plaintext in Isar:** The `FinancialRecordIsar` schema has zero plaintext sensitive columns. A raw Isar database dump or a developer connected via Isar Inspector will see only base64 ciphertext blobs.

- **Clean Architecture boundary:** The `FinancialRecord` domain entity carries plaintext fields (the canonical representation in the app's memory). The encrypt/decrypt cycle is entirely encapsulated in `FinancialRecordRepositoryImpl`. The domain layer (entities, use cases, repository interfaces) has no import from `encrypt`, `isar`, or `flutter_secure_storage`.

- **Unidirectional, immutable state:** `ProfileState` is a `final class` with a `copyWith` factory. `ProfileCubit` always emits a new state instance — no field mutation in place. `BlocBuilder` rebuilds only when the state reference changes.

- **No data fetching in `initState`:** `loadProfile` is dispatched via `addPostFrameCallback`, which safely defers the Cubit call until after the first frame is rendered, avoiding the anti-pattern of triggering side effects mid-build.

- **Corrupt record tolerance:** If a single `FinancialRecordIsar` row fails decryption (e.g., partial write, key rotation mismatch), the repository logs the record ID and skips it rather than throwing and breaking the entire list load. In production, forward the error to a crash reporter.

- **Error propagation with `Either`:** All repository methods return `Either<Failure, T>`. No exception leaks past the data layer into the domain or presentation. The Cubit maps `Left(failure)` to a `ProfileStatus.error` state that the UI renders explicitly.

- **Resource safety:** `IsarDatasource` wraps a `late final Isar` opened once. There is no explicit `close()` needed for the app lifecycle (Isar handles process exit), but if you need multi-user session switching, call `isar.close()` and re-open with `initialize()` — the datasource is the single chokepoint for that operation.

- **No `dynamic`, no empty catches, no `print()` in production paths:** Error handling uses typed `on IsarError` and `on EncryptionException` clauses. The `assert`-guarded debug log in the repository compiles away in release mode. No `dynamic` type is used anywhere in the data or domain layers.
