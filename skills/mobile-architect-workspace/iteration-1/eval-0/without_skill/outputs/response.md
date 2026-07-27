# Flutter Auth Flow with Supabase: Architecture & Core Code

## Architecture Overview

The right architecture separates concerns into four layers:

1. **Supabase Auth Service** — wraps Supabase calls, exposes streams
2. **Auth Repository** — business logic, session persistence
3. **Auth State (Riverpod/Bloc)** — reactive state management
4. **Router (GoRouter)** — listens to auth state, redirects accordingly

### Dependency flow

```
Router
  └── listens to AuthNotifier
        └── consumes AuthRepository
              └── wraps SupabaseClient
```

Token refresh is handled automatically by the Supabase Flutter SDK — it stores the session in `SharedPreferences` (or `flutter_secure_storage` for hardened security) and refreshes the JWT before it expires. Your job is to initialize Supabase correctly, forward the session stream to your state layer, and let the router react.

---

## Dependencies (`pubspec.yaml`)

```yaml
dependencies:
  flutter:
    sdk: flutter
  supabase_flutter: ^2.5.0
  flutter_riverpod: ^2.5.1
  riverpod_annotation: ^2.3.5
  go_router: ^13.2.0
  flutter_secure_storage: ^9.0.0

dev_dependencies:
  build_runner: ^2.4.9
  riverpod_generator: ^2.4.0
```

---

## 1. Initialization (`main.dart`)

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'router.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Supabase.initialize(
    url: const String.fromEnvironment('SUPABASE_URL'),
    anonKey: const String.fromEnvironment('SUPABASE_ANON_KEY'),
    // The SDK persists the session automatically using SharedPreferences.
    // For higher security, swap in a custom localStorage backed by
    // flutter_secure_storage (see Section 2).
    authOptions: const FlutterAuthClientOptions(
      authFlowType: AuthFlowType.pkce, // PKCE is more secure than implicit
    ),
  );

  runApp(const ProviderScope(child: MyApp()));
}

class MyApp extends ConsumerWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'My App',
      routerConfig: router,
    );
  }
}
```

---

## 2. Secure Session Storage (`secure_storage.dart`)

The default Supabase session storage uses `SharedPreferences`, which is not encrypted. For production apps swap it with `flutter_secure_storage`:

```dart
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class SecureSessionStorage extends LocalStorage {
  SecureSessionStorage()
      : super(
          initialize: () async {},
          hasAccessToken: () async {
            const storage = FlutterSecureStorage();
            final value = await storage.read(key: _key);
            return value != null;
          },
          accessToken: () async {
            const storage = FlutterSecureStorage();
            return storage.read(key: _key);
          },
          removePersistedSession: () async {
            const storage = FlutterSecureStorage();
            await storage.delete(key: _key);
          },
          persistSession: (String value) async {
            const storage = FlutterSecureStorage();
            await storage.write(key: _key, value: value);
          },
        );

  static const _key = 'supabase_session';
}
```

Then pass it to `Supabase.initialize`:

```dart
await Supabase.initialize(
  url: ...,
  anonKey: ...,
  localStorage: SecureSessionStorage(),
  authOptions: const FlutterAuthClientOptions(
    authFlowType: AuthFlowType.pkce,
  ),
);
```

---

## 3. Auth Repository (`auth_repository.dart`)

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

part 'auth_repository.g.dart';

class AuthRepository {
  AuthRepository(this._client);

  final SupabaseClient _client;

  /// The current session, null if signed out.
  Session? get currentSession => _client.auth.currentSession;

  /// Stream of auth state changes emitted by Supabase.
  /// This fires on: sign-in, sign-out, token refresh, password recovery, etc.
  Stream<AuthState> get authStateChanges => _client.auth.onAuthStateChange;

  Future<void> signInWithEmailAndPassword({
    required String email,
    required String password,
  }) async {
    await _client.auth.signInWithPassword(
      email: email,
      password: password,
    );
    // Throws AuthException on failure — let callers handle it.
  }

  Future<void> signUp({
    required String email,
    required String password,
  }) async {
    await _client.auth.signUp(
      email: email,
      password: password,
    );
  }

  Future<void> signOut() async {
    await _client.auth.signOut();
  }

  Future<void> resetPassword(String email) async {
    await _client.auth.resetPasswordForEmail(email);
  }
}

@riverpod
SupabaseClient supabaseClient(Ref ref) => Supabase.instance.client;

@riverpod
AuthRepository authRepository(Ref ref) {
  return AuthRepository(ref.watch(supabaseClientProvider));
}
```

---

## 4. Auth State Notifier (`auth_notifier.dart`)

```dart
import 'dart:async';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'auth_repository.dart';

part 'auth_notifier.g.dart';

/// Represents the current authentication status.
enum AuthStatus { loading, authenticated, unauthenticated }

class AuthState {
  const AuthState({required this.status, this.session});

  final AuthStatus status;
  final Session? session;

  bool get isAuthenticated => status == AuthStatus.authenticated;
}

@riverpod
class AuthNotifier extends _$AuthNotifier {
  StreamSubscription<supabase_flutter.AuthState>? _subscription;

  @override
  AuthState build() {
    final repo = ref.watch(authRepositoryProvider);

    // Seed from the persisted session so there's no flash of the login screen
    // on restart when the user is already authenticated.
    final initial = repo.currentSession != null
        ? const AuthState(status: AuthStatus.authenticated)
        : const AuthState(status: AuthStatus.unauthenticated);

    // Subscribe to future changes (sign in, sign out, token refresh).
    _subscription?.cancel();
    _subscription = repo.authStateChanges.listen(_onAuthStateChange);

    ref.onDispose(() => _subscription?.cancel());

    return initial;
  }

  void _onAuthStateChange(supabase_flutter.AuthState event) {
    switch (event.event) {
      case AuthChangeEvent.signedIn:
      case AuthChangeEvent.tokenRefreshed:
      case AuthChangeEvent.userUpdated:
        state = AuthState(
          status: AuthStatus.authenticated,
          session: event.session,
        );
      case AuthChangeEvent.signedOut:
      case AuthChangeEvent.userDeleted:
        state = const AuthState(status: AuthStatus.unauthenticated);
      case AuthChangeEvent.passwordRecovery:
        // Handle password recovery screen redirect if needed.
        break;
      default:
        break;
    }
  }

  Future<void> signIn({required String email, required String password}) async {
    state = const AuthState(status: AuthStatus.loading);
    try {
      await ref.read(authRepositoryProvider).signInWithEmailAndPassword(
            email: email,
            password: password,
          );
      // State update comes via the stream — don't set it manually here.
    } on AuthException {
      state = const AuthState(status: AuthStatus.unauthenticated);
      rethrow; // Let the UI display the error.
    }
  }

  Future<void> signOut() async {
    await ref.read(authRepositoryProvider).signOut();
    // Stream fires signedOut → state updates automatically.
  }
}
```

---

## 5. Auth-Driven Router (`router.dart`)

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'auth_notifier.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'screens/splash_screen.dart';

part 'router.g.dart';

// Route names as constants to avoid typos.
abstract class AppRoutes {
  static const splash = '/';
  static const login = '/login';
  static const home = '/home';
}

@riverpod
GoRouter router(Ref ref) {
  // Keep a reference so GoRouter can call refresh when auth changes.
  final notifier = ref.watch(authNotifierProvider.notifier);
  final authState = ref.watch(authNotifierProvider);

  return GoRouter(
    initialLocation: AppRoutes.splash,
    // refreshListenable wires GoRouter to re-evaluate redirect whenever
    // the auth notifier rebuilds.
    refreshListenable: GoRouterRefreshStream(
      ref.watch(authRepositoryProvider).authStateChanges,
    ),
    redirect: (context, routerState) {
      final status = authState.status;
      final location = routerState.matchedLocation;

      if (status == AuthStatus.loading) {
        return AppRoutes.splash; // Show splash while resolving session.
      }

      final isOnAuthScreen = location == AppRoutes.login;

      if (status == AuthStatus.unauthenticated && !isOnAuthScreen) {
        return AppRoutes.login;
      }

      if (status == AuthStatus.authenticated && isOnAuthScreen) {
        return AppRoutes.home;
      }

      return null; // No redirect needed.
    },
    routes: [
      GoRoute(
        path: AppRoutes.splash,
        builder: (_, __) => const SplashScreen(),
      ),
      GoRoute(
        path: AppRoutes.login,
        builder: (_, __) => const LoginScreen(),
      ),
      GoRoute(
        path: AppRoutes.home,
        builder: (_, __) => const HomeScreen(),
        // Add nested/child routes for protected screens here.
        routes: [
          // GoRoute(path: 'profile', builder: (_, __) => const ProfileScreen()),
        ],
      ),
    ],
  );
}

/// Bridges a [Stream] to [ChangeNotifier] so GoRouter can listen to it.
class GoRouterRefreshStream extends ChangeNotifier {
  GoRouterRefreshStream(Stream<dynamic> stream) {
    notifyListeners();
    _subscription = stream.listen((_) => notifyListeners());
  }

  late final StreamSubscription<dynamic> _subscription;

  @override
  void dispose() {
    _subscription.cancel();
    super.dispose();
  }
}
```

---

## 6. Login Screen (`login_screen.dart`)

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../auth_notifier.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isLoading = false;
  String? _errorMessage;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      await ref.read(authNotifierProvider.notifier).signIn(
            email: _emailController.text.trim(),
            password: _passwordController.text,
          );
      // GoRouter's redirect will navigate to home on success.
    } on AuthException catch (e) {
      setState(() => _errorMessage = e.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sign In')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(labelText: 'Email'),
                validator: (v) =>
                    (v == null || !v.contains('@')) ? 'Enter a valid email' : null,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _passwordController,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'Password'),
                validator: (v) =>
                    (v == null || v.length < 6) ? 'Min 6 characters' : null,
              ),
              const SizedBox(height: 24),
              if (_errorMessage != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(
                    _errorMessage!,
                    style: TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                ),
              FilledButton(
                onPressed: _isLoading ? null : _submit,
                child: _isLoading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Sign In'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
```

---

## 7. Protected Home Screen (sign-out example)

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../auth_notifier.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(authNotifierProvider).session;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Home'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authNotifierProvider.notifier).signOut(),
          ),
        ],
      ),
      body: Center(
        child: Text('Logged in as: ${session?.user.email ?? 'Unknown'}'),
      ),
    );
  }
}
```

---

## How Token Refresh Works

You do **not** need to write token refresh logic. Here is what happens automatically:

1. `Supabase.initialize()` restores the persisted session on startup.
2. The Supabase SDK schedules a background timer to call `/auth/v1/token?grant_type=refresh_token` ~60 seconds before the access token expires (default 1 hour).
3. On success it fires `AuthChangeEvent.tokenRefreshed` on `onAuthStateChange`.
4. `AuthNotifier._onAuthStateChange` receives that event and updates state with the new session.
5. The new session (with fresh JWT) is persisted automatically.
6. If the refresh fails (e.g. revoked refresh token), a `signedOut` event fires and the router redirects to login.

The only thing you must ensure is that **`Supabase.initialize` is awaited before `runApp`** — that is what allows session restoration before the first frame.

---

## Key Design Decisions & Trade-offs

| Decision | Rationale |
|---|---|
| PKCE flow | More secure than implicit flow; prevents token interception in deep links |
| `flutter_secure_storage` | Encrypted on-device storage vs plain `SharedPreferences`; essential for sensitive tokens |
| Seed state from `currentSession` | Prevents unauthenticated flash on app restart when session exists |
| Stream → GoRouter via `ChangeNotifier` | GoRouter's `refreshListenable` needs a `Listenable`; bridging the Supabase stream is the standard pattern |
| Error rethrown from `signIn` | Keeps error display in the UI layer; auth state stays clean |
| No manual redirect after sign-in | Router's redirect function handles it declaratively — less coupling |

---

## File Structure

```
lib/
├── main.dart
├── router.dart
├── auth/
│   ├── auth_repository.dart
│   ├── auth_notifier.dart
│   └── secure_storage.dart
└── screens/
    ├── splash_screen.dart
    ├── login_screen.dart
    └── home_screen.dart
```

---

## Common Pitfalls

- **Don't call `GoRouter.of(context).go()` after sign-in.** Let the router's `redirect` handle it. Manually pushing after auth can cause double-navigation.
- **Don't store the JWT in plain SharedPreferences in production.** Use `flutter_secure_storage`.
- **Always `await Supabase.initialize()`** before `runApp`. Skipping the await means `currentSession` is always null on the first build.
- **Null-check `session` in the notifier before asserting authenticated.** The SDK can emit `signedIn` with a null session in edge cases during PKCE callback.
- **Handle `AuthChangeEvent.passwordRecovery`** if you support password reset — redirect to a change-password screen rather than home.
