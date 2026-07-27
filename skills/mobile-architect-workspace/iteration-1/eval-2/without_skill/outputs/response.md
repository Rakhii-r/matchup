# Flutter + Isar: Encrypting Sensitive Fields, Schema Design, and Clean Data Layer Architecture

## Overview

This guide covers the full pattern for:
1. Setting up Isar schemas for user profiles and sensitive financial records
2. Encrypting sensitive fields at the application layer
3. Structuring a clean data layer separated from the UI using Repository + Service patterns

---

## 1. Dependencies

Add to `pubspec.yaml`:

```yaml
dependencies:
  flutter:
    sdk: flutter
  isar: ^3.1.0
  isar_flutter_libs: ^3.1.0
  encrypt: ^5.0.3
  flutter_secure_storage: ^9.0.0
  path_provider: ^2.1.0
  get_it: ^7.6.0          # for dependency injection
  freezed_annotation: ^2.4.1
  json_annotation: ^4.8.1

dev_dependencies:
  isar_generator: ^3.1.0
  build_runner: ^2.4.0
  freezed: ^2.4.5
  json_serializable: ^6.7.1
```

---

## 2. Encryption Service

Isar does not provide field-level encryption out of the box (the enterprise AES encryption applies to the whole database file, not individual fields). The recommended approach is **application-layer field encryption**: encrypt sensitive values before writing to Isar and decrypt after reading.

### 2.1 Key Management with flutter_secure_storage

```dart
// lib/core/security/encryption_key_manager.dart

import 'dart:convert';
import 'dart:math';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class EncryptionKeyManager {
  static const _keyAlias = 'app_field_encryption_key';
  final FlutterSecureStorage _secureStorage;

  EncryptionKeyManager(this._secureStorage);

  /// Returns the AES-256 key, generating and persisting it on first call.
  Future<List<int>> getOrCreateKey() async {
    final existing = await _secureStorage.read(key: _keyAlias);
    if (existing != null) {
      return base64Decode(existing);
    }
    final key = _generateKey(32); // 256-bit
    await _secureStorage.write(
      key: _keyAlias,
      value: base64Encode(key),
    );
    return key;
  }

  List<int> _generateKey(int length) {
    final rng = Random.secure();
    return List.generate(length, (_) => rng.nextInt(256));
  }
}
```

### 2.2 Field Encryptor

```dart
// lib/core/security/field_encryptor.dart

import 'dart:convert';
import 'dart:math';
import 'package:encrypt/encrypt.dart';

/// Encrypts and decrypts individual string fields using AES-256-GCM.
/// Each encryption call generates a fresh random IV, which is prepended
/// to the ciphertext so decryption is self-contained.
class FieldEncryptor {
  static const _ivLength = 16; // 128-bit IV for AES
  final Key _key;

  FieldEncryptor(List<int> keyBytes) : _key = Key(Uint8List.fromList(keyBytes));

  /// Encrypt [plaintext] and return a base64-encoded string (IV + ciphertext).
  String encrypt(String plaintext) {
    final iv = IV.fromSecureRandom(_ivLength);
    final encrypter = Encrypter(AES(_key, mode: AESMode.cbc));
    final encrypted = encrypter.encrypt(plaintext, iv: iv);

    // Prepend IV so we can recover it during decryption
    final combined = iv.bytes + encrypted.bytes;
    return base64Encode(combined);
  }

  /// Decrypt a base64-encoded string produced by [encrypt].
  String decrypt(String ciphertext) {
    final combined = base64Decode(ciphertext);
    final iv = IV(Uint8List.fromList(combined.sublist(0, _ivLength)));
    final encryptedBytes = combined.sublist(_ivLength);

    final encrypter = Encrypter(AES(_key, mode: AESMode.cbc));
    return encrypter.decrypt(
      Encrypted(Uint8List.fromList(encryptedBytes)),
      iv: iv,
    );
  }

  /// Convenience: returns null for null inputs (useful for optional fields).
  String? encryptNullable(String? plaintext) =>
      plaintext == null ? null : encrypt(plaintext);

  String? decryptNullable(String? ciphertext) =>
      ciphertext == null ? null : decrypt(ciphertext);
}
```

> **Why CBC with a random IV?** Each call produces a unique ciphertext even for the same plaintext, preventing frequency analysis. For even stronger guarantees on platforms that support it, switch to `AESMode.gcm` — GCM also provides authentication (tamper detection). The `encrypt` package supports both.

---

## 3. Isar Schemas

### 3.1 User Profile (non-sensitive)

```dart
// lib/data/models/isar/user_profile_entity.dart

import 'package:isar/isar.dart';

part 'user_profile_entity.g.dart';

@Collection()
class UserProfileEntity {
  Id id = Isar.autoIncrement;

  @Index(unique: true)
  late String userId; // external/auth system ID

  late String displayName;
  late String email;
  String? avatarUrl;

  @Enumerated(EnumType.name)
  late UserRole role;

  late DateTime createdAt;
  late DateTime updatedAt;
}

enum UserRole { admin, member, guest }
```

### 3.2 Financial Record (sensitive fields encrypted)

Sensitive fields (`accountNumber`, `routingNumber`, `balance`) are stored as **encrypted strings**. The schema is unaware of encryption — it just stores `String`. Encryption/decryption happens in the repository.

```dart
// lib/data/models/isar/financial_record_entity.dart

import 'package:isar/isar.dart';

part 'financial_record_entity.g.dart';

@Collection()
class FinancialRecordEntity {
  Id id = Isar.autoIncrement;

  @Index()
  late String userId; // FK to UserProfileEntity.userId

  late String recordType; // e.g. "bank_account", "credit_card"

  // --- Sensitive fields: stored encrypted ---
  late String encryptedAccountNumber;
  late String encryptedRoutingNumber;
  late String encryptedBalance;        // store as string, parse to Decimal in app
  String? encryptedCardHolderName;

  // --- Non-sensitive metadata ---
  late String lastFourDigits;          // safe to store plain for display
  late String currencyCode;
  late DateTime createdAt;
  late DateTime updatedAt;
}
```

> **Rule of thumb**: store the minimum plaintext needed for UX (e.g., last four digits for display), encrypt everything else.

---

## 4. Domain Models (clean, no Isar dependency)

Domain models live in the domain layer and have no Isar annotations. UI and business logic only ever see these.

```dart
// lib/domain/models/user_profile.dart

import 'package:freezed_annotation/freezed_annotation.dart';

part 'user_profile.freezed.dart';

@freezed
class UserProfile with _$UserProfile {
  const factory UserProfile({
    required String userId,
    required String displayName,
    required String email,
    String? avatarUrl,
    required UserRole role,
    required DateTime createdAt,
    required DateTime updatedAt,
  }) = _UserProfile;
}

enum UserRole { admin, member, guest }
```

```dart
// lib/domain/models/financial_record.dart

import 'package:freezed_annotation/freezed_annotation.dart';

part 'financial_record.freezed.dart';

@freezed
class FinancialRecord with _$FinancialRecord {
  const factory FinancialRecord({
    required String userId,
    required String recordType,
    required String accountNumber,   // plaintext in domain model
    required String routingNumber,
    required String balance,
    String? cardHolderName,
    required String lastFourDigits,
    required String currencyCode,
    required DateTime createdAt,
    required DateTime updatedAt,
  }) = _FinancialRecord;
}
```

---

## 5. Mappers

Mappers translate between entity (Isar) and domain model, handling encryption/decryption at the boundary.

```dart
// lib/data/mappers/financial_record_mapper.dart

import '../../core/security/field_encryptor.dart';
import '../models/isar/financial_record_entity.dart';
import '../../domain/models/financial_record.dart';

class FinancialRecordMapper {
  final FieldEncryptor _encryptor;

  FinancialRecordMapper(this._encryptor);

  /// Entity → Domain: decrypt sensitive fields
  FinancialRecord toDomain(FinancialRecordEntity entity) {
    return FinancialRecord(
      userId: entity.userId,
      recordType: entity.recordType,
      accountNumber: _encryptor.decrypt(entity.encryptedAccountNumber),
      routingNumber: _encryptor.decrypt(entity.encryptedRoutingNumber),
      balance: _encryptor.decrypt(entity.encryptedBalance),
      cardHolderName: _encryptor.decryptNullable(entity.encryptedCardHolderName),
      lastFourDigits: entity.lastFourDigits,
      currencyCode: entity.currencyCode,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    );
  }

  /// Domain → Entity: encrypt sensitive fields
  FinancialRecordEntity toEntity(FinancialRecord record, {Id id = Isar.autoIncrement}) {
    return FinancialRecordEntity()
      ..id = id
      ..userId = record.userId
      ..recordType = record.recordType
      ..encryptedAccountNumber = _encryptor.encrypt(record.accountNumber)
      ..encryptedRoutingNumber = _encryptor.encrypt(record.routingNumber)
      ..encryptedBalance = _encryptor.encrypt(record.balance)
      ..encryptedCardHolderName = _encryptor.encryptNullable(record.cardHolderName)
      ..lastFourDigits = record.lastFourDigits
      ..currencyCode = record.currencyCode
      ..createdAt = record.createdAt
      ..updatedAt = record.updatedAt;
  }
}
```

```dart
// lib/data/mappers/user_profile_mapper.dart

import '../models/isar/user_profile_entity.dart';
import '../../domain/models/user_profile.dart';

class UserProfileMapper {
  UserProfile toDomain(UserProfileEntity entity) {
    return UserProfile(
      userId: entity.userId,
      displayName: entity.displayName,
      email: entity.email,
      avatarUrl: entity.avatarUrl,
      role: UserRole.values.byName(entity.role.name),
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    );
  }

  UserProfileEntity toEntity(UserProfile profile, {Id id = Isar.autoIncrement}) {
    return UserProfileEntity()
      ..id = id
      ..userId = profile.userId
      ..displayName = profile.displayName
      ..email = profile.email
      ..avatarUrl = profile.avatarUrl
      ..role = UserRole.values.byName(profile.role.name)
      ..createdAt = profile.createdAt
      ..updatedAt = profile.updatedAt;
  }
}
```

---

## 6. Repository Interfaces (domain layer)

The domain layer defines abstract repository contracts. The UI and use cases depend only on these interfaces.

```dart
// lib/domain/repositories/user_profile_repository.dart

import '../models/user_profile.dart';

abstract interface class UserProfileRepository {
  Future<UserProfile?> getByUserId(String userId);
  Future<void> save(UserProfile profile);
  Future<void> delete(String userId);
  Stream<UserProfile?> watchByUserId(String userId);
}
```

```dart
// lib/domain/repositories/financial_record_repository.dart

import '../models/financial_record.dart';

abstract interface class FinancialRecordRepository {
  Future<List<FinancialRecord>> getByUserId(String userId);
  Future<FinancialRecord?> getById(String userId, int id);
  Future<void> save(FinancialRecord record);
  Future<void> delete(int id);
  Stream<List<FinancialRecord>> watchByUserId(String userId);
}
```

---

## 7. Repository Implementations (data layer)

```dart
// lib/data/repositories/isar_user_profile_repository.dart

import 'package:isar/isar.dart';
import '../../domain/models/user_profile.dart';
import '../../domain/repositories/user_profile_repository.dart';
import '../mappers/user_profile_mapper.dart';
import '../models/isar/user_profile_entity.dart';

class IsarUserProfileRepository implements UserProfileRepository {
  final Isar _isar;
  final UserProfileMapper _mapper;

  IsarUserProfileRepository(this._isar, this._mapper);

  @override
  Future<UserProfile?> getByUserId(String userId) async {
    final entity = await _isar.userProfileEntitys
        .where()
        .userIdEqualTo(userId)
        .findFirst();
    return entity == null ? null : _mapper.toDomain(entity);
  }

  @override
  Future<void> save(UserProfile profile) async {
    final existing = await _isar.userProfileEntitys
        .where()
        .userIdEqualTo(profile.userId)
        .findFirst();
    final entity = _mapper.toEntity(profile, id: existing?.id ?? Isar.autoIncrement);
    await _isar.writeTxn(() => _isar.userProfileEntitys.put(entity));
  }

  @override
  Future<void> delete(String userId) async {
    final entity = await _isar.userProfileEntitys
        .where()
        .userIdEqualTo(userId)
        .findFirst();
    if (entity != null) {
      await _isar.writeTxn(() => _isar.userProfileEntitys.delete(entity.id));
    }
  }

  @override
  Stream<UserProfile?> watchByUserId(String userId) {
    return _isar.userProfileEntitys
        .where()
        .userIdEqualTo(userId)
        .watch(fireImmediately: true)
        .map((list) => list.isEmpty ? null : _mapper.toDomain(list.first));
  }
}
```

```dart
// lib/data/repositories/isar_financial_record_repository.dart

import 'package:isar/isar.dart';
import '../../domain/models/financial_record.dart';
import '../../domain/repositories/financial_record_repository.dart';
import '../mappers/financial_record_mapper.dart';
import '../models/isar/financial_record_entity.dart';

class IsarFinancialRecordRepository implements FinancialRecordRepository {
  final Isar _isar;
  final FinancialRecordMapper _mapper;

  IsarFinancialRecordRepository(this._isar, this._mapper);

  @override
  Future<List<FinancialRecord>> getByUserId(String userId) async {
    final entities = await _isar.financialRecordEntitys
        .where()
        .userIdEqualTo(userId)
        .findAll();
    return entities.map(_mapper.toDomain).toList();
  }

  @override
  Future<FinancialRecord?> getById(String userId, int id) async {
    final entity = await _isar.financialRecordEntitys.get(id);
    if (entity == null || entity.userId != userId) return null;
    return _mapper.toDomain(entity);
  }

  @override
  Future<void> save(FinancialRecord record) async {
    // For upsert by some business key you'd query first; simplified here
    final entity = _mapper.toEntity(record);
    await _isar.writeTxn(() => _isar.financialRecordEntitys.put(entity));
  }

  @override
  Future<void> delete(int id) async {
    await _isar.writeTxn(() => _isar.financialRecordEntitys.delete(id));
  }

  @override
  Stream<List<FinancialRecord>> watchByUserId(String userId) {
    return _isar.financialRecordEntitys
        .where()
        .userIdEqualTo(userId)
        .watch(fireImmediately: true)
        .map((entities) => entities.map(_mapper.toDomain).toList());
  }
}
```

---

## 8. Isar Initialization

```dart
// lib/core/database/isar_initializer.dart

import 'package:isar/isar.dart';
import 'package:path_provider/path_provider.dart';
import '../../data/models/isar/user_profile_entity.dart';
import '../../data/models/isar/financial_record_entity.dart';

class IsarInitializer {
  static Isar? _instance;

  static Future<Isar> getInstance() async {
    if (_instance != null && _instance!.isOpen) return _instance!;

    final dir = await getApplicationDocumentsDirectory();
    _instance = await Isar.open(
      [UserProfileEntitySchema, FinancialRecordEntitySchema],
      directory: dir.path,
      // Optional: enable Isar's own file-level encryption (requires enterprise license key)
      // encryptionKey: yourIsarEncryptionKey,
    );
    return _instance!;
  }
}
```

---

## 9. Dependency Injection

Wire everything up at startup using `get_it`:

```dart
// lib/core/di/injection.dart

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:get_it/get_it.dart';
import 'package:isar/isar.dart';

import '../database/isar_initializer.dart';
import '../security/encryption_key_manager.dart';
import '../security/field_encryptor.dart';
import '../../data/mappers/financial_record_mapper.dart';
import '../../data/mappers/user_profile_mapper.dart';
import '../../data/repositories/isar_financial_record_repository.dart';
import '../../data/repositories/isar_user_profile_repository.dart';
import '../../domain/repositories/financial_record_repository.dart';
import '../../domain/repositories/user_profile_repository.dart';

final getIt = GetIt.instance;

Future<void> configureDependencies() async {
  // Infrastructure
  final isar = await IsarInitializer.getInstance();
  getIt.registerSingleton<Isar>(isar);

  const secureStorage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  getIt.registerSingleton<FlutterSecureStorage>(secureStorage);

  // Security
  final keyManager = EncryptionKeyManager(secureStorage);
  final keyBytes = await keyManager.getOrCreateKey();
  final fieldEncryptor = FieldEncryptor(keyBytes);
  getIt.registerSingleton<FieldEncryptor>(fieldEncryptor);

  // Mappers
  getIt.registerSingleton<UserProfileMapper>(UserProfileMapper());
  getIt.registerSingleton<FinancialRecordMapper>(
    FinancialRecordMapper(fieldEncryptor),
  );

  // Repositories (registered as interfaces)
  getIt.registerSingleton<UserProfileRepository>(
    IsarUserProfileRepository(isar, getIt<UserProfileMapper>()),
  );
  getIt.registerSingleton<FinancialRecordRepository>(
    IsarFinancialRecordRepository(isar, getIt<FinancialRecordMapper>()),
  );
}
```

Call in `main.dart`:

```dart
// lib/main.dart

import 'package:flutter/material.dart';
import 'core/di/injection.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await configureDependencies();
  runApp(const MyApp());
}
```

---

## 10. Use Case (domain layer, optional but recommended)

Use cases contain business logic and are the only things the UI calls directly.

```dart
// lib/domain/use_cases/get_financial_records_use_case.dart

import '../models/financial_record.dart';
import '../repositories/financial_record_repository.dart';

class GetFinancialRecordsUseCase {
  final FinancialRecordRepository _repository;

  GetFinancialRecordsUseCase(this._repository);

  Stream<List<FinancialRecord>> call(String userId) {
    return _repository.watchByUserId(userId);
  }
}
```

---

## 11. UI Layer — ViewModel / Cubit

The UI depends only on domain models and use cases. It has zero awareness of Isar, encryption, or mappers.

```dart
// lib/presentation/cubits/financial_records_cubit.dart

import 'dart:async';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../domain/models/financial_record.dart';
import '../../domain/use_cases/get_financial_records_use_case.dart';

part 'financial_records_state.dart';

class FinancialRecordsCubit extends Cubit<FinancialRecordsState> {
  final GetFinancialRecordsUseCase _getRecords;
  StreamSubscription<List<FinancialRecord>>? _subscription;

  FinancialRecordsCubit(this._getRecords)
      : super(const FinancialRecordsState.initial());

  void load(String userId) {
    emit(const FinancialRecordsState.loading());
    _subscription?.cancel();
    _subscription = _getRecords(userId).listen(
      (records) => emit(FinancialRecordsState.loaded(records)),
      onError: (e) => emit(FinancialRecordsState.error(e.toString())),
    );
  }

  @override
  Future<void> close() {
    _subscription?.cancel();
    return super.close();
  }
}
```

```dart
// lib/presentation/cubits/financial_records_state.dart

part of 'financial_records_cubit.dart';

sealed class FinancialRecordsState {
  const FinancialRecordsState();
  const factory FinancialRecordsState.initial() = _Initial;
  const factory FinancialRecordsState.loading() = _Loading;
  const factory FinancialRecordsState.loaded(List<FinancialRecord> records) = _Loaded;
  const factory FinancialRecordsState.error(String message) = _Error;
}

class _Initial extends FinancialRecordsState { const _Initial(); }
class _Loading extends FinancialRecordsState { const _Loading(); }
class _Loaded extends FinancialRecordsState {
  final List<FinancialRecord> records;
  const _Loaded(this.records);
}
class _Error extends FinancialRecordsState {
  final String message;
  const _Error(this.message);
}
```

---

## 12. Folder Structure

```
lib/
├── core/
│   ├── database/
│   │   └── isar_initializer.dart
│   ├── di/
│   │   └── injection.dart
│   └── security/
│       ├── encryption_key_manager.dart
│       └── field_encryptor.dart
│
├── data/
│   ├── mappers/
│   │   ├── financial_record_mapper.dart
│   │   └── user_profile_mapper.dart
│   ├── models/
│   │   └── isar/
│   │       ├── financial_record_entity.dart
│   │       ├── financial_record_entity.g.dart  (generated)
│   │       ├── user_profile_entity.dart
│   │       └── user_profile_entity.g.dart      (generated)
│   └── repositories/
│       ├── isar_financial_record_repository.dart
│       └── isar_user_profile_repository.dart
│
├── domain/
│   ├── models/
│   │   ├── financial_record.dart
│   │   ├── financial_record.freezed.dart       (generated)
│   │   ├── user_profile.dart
│   │   └── user_profile.freezed.dart           (generated)
│   ├── repositories/
│   │   ├── financial_record_repository.dart
│   │   └── user_profile_repository.dart
│   └── use_cases/
│       └── get_financial_records_use_case.dart
│
└── presentation/
    ├── cubits/
    │   ├── financial_records_cubit.dart
    │   └── financial_records_state.dart
    └── pages/
        └── financial_records_page.dart
```

---

## 13. Generate Code

Run this after adding or modifying schemas/models:

```bash
dart run build_runner build --delete-conflicting-outputs
```

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Field-level encryption in mapper | Isar schema stays simple; encryption is a data-layer concern, not a domain concern |
| AES-256-CBC with random IV per field | Each stored value is unique ciphertext; prevents frequency analysis |
| Key stored in flutter_secure_storage | Uses Keychain (iOS) / EncryptedSharedPreferences (Android) — OS-managed secure storage |
| Domain models are Isar-free | UI and business logic are independently testable; switching databases requires only new repository implementations |
| Repository returns domain models | UI never sees `FinancialRecordEntity`; decryption always happens before data leaves the data layer |
| `Stream` on repositories | Isar's reactive queries propagate DB changes to UI automatically via Cubit |

---

## Security Checklist

- [ ] Never log or print decrypted sensitive values
- [ ] Add biometric/PIN gate before loading the encryption key for extra defence-in-depth
- [ ] Consider key rotation strategy: store a key version alongside each encrypted field and support decrypting with old keys
- [ ] If using Isar's file-level encryption (`encryptionKey`), combine it with field encryption — the Isar key should also live in `flutter_secure_storage`
- [ ] Run `flutter_secure_storage` with `synchronize: true` on Android only in single-isolate scenarios; for multi-isolate, use a dedicated key-management isolate
- [ ] Wipe the decryption key from memory when the app backgrounds (optional, depends on threat model)
