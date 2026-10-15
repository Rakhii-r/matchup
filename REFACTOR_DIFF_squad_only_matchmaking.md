# Squad-only matchmaking + strict format matching — change log

Generated 2026-09-04 05:33 UTC. Diffs are against the working tree as it stood before this refactor.

## Files deleted
```
app/teams/find-players.tsx          280 lines  solo player browses squads, asks to join
app/match/create/player-searching.tsx 626 lines  captain watches solo applicants arrive
app/teams/[id]/requests.tsx                     captain's inbox for solo join requests
```

## Files added
```
supabase/migrations/20260903090000_squad_only_matchmaking.sql
src/features/teams/presentation/useActiveTeamFormat.ts
```

## Diffs

### app/(tabs)/index.tsx
```diff
--- a/app/(tabs)/index.tsx
+++ b/app/(tabs)/index.tsx
@@ -48,6 +48,10 @@
   useNearbyOpenChallenges,
 } from '@features/teams/presentation/useChallenges';
 import { MatchOfferDetailModal } from '@features/teams/presentation/MatchOfferDetailModal';
+import {
+  formatLabel,
+  useActiveTeamFormat,
+} from '@features/teams/presentation/useActiveTeamFormat';
 import { useMyTeamsOverview } from '@features/teams/presentation/useTeams';
 import type { NearbyOpenChallenge } from '@features/teams/domain/challengeSchema';
 import { useVenues } from '@features/venues/presentation/useVenues';
@@ -431,7 +435,14 @@
   const venues = useVenues();
   const joined = useJoinedMatches();
   const challenges = useMyChallenges();
-  const openChallenges = useNearbyOpenChallenges(coords, sport);
+  /*
+    Home's opponent rail is format-locked exactly like the Games tab's, and for
+    the same reason: two screens showing different opponent sets for the same
+    user is worse than either being wrong. The format comes from the team the
+    user owns; `list_open_challenges_nearby` applies it server-side.
+  */
+  const activeFormat = useActiveTeamFormat(sport);
+  const openChallenges = useNearbyOpenChallenges(coords, sport, undefined, activeFormat.format);
   const applyToChallenge = useApplyToChallenge();
   const myTeams = useMyTeamsOverview();
   const sportLabel = useSportLabel();
@@ -459,17 +470,45 @@
 
   const onChallengeTeam = useCallback(
     (item: NearbyOpenChallenge) => {
+      const fixtureFormat = Math.max(Math.floor(item.total_slots / 2), 1);
+
+      // Same sport AND same format — the server refuses anything else with
+      // FORMAT_MISMATCH, so a team that fails this filter is a button that
+      // cannot work.
       const ownedMatching = (myTeams.data ?? []).filter(
-        (t) => t.i_am_owner && (!item.sport || t.sport === item.sport),
+        (t) =>
+          t.i_am_owner &&
+          (!item.sport || t.sport === item.sport) &&
+          t.target_size === fixtureFormat,
       );
 
       if (ownedMatching.length === 0) {
+        const sameSport = (myTeams.data ?? []).filter(
+          (t) => t.i_am_owner && (!item.sport || t.sport === item.sport),
+        );
+        if (sameSport.length === 0) {
+          Alert.alert(
+            'Team needed',
+            `You need a ${item.sport === 'box_cricket' ? 'Cricket' : item.sport} team to challenge this squad. Create a team first!`,
+            [
+              { text: 'Cancel', style: 'cancel' },
+              { text: 'Create Team', onPress: () => router.push('/teams/create') },
+            ],
+          );
+          return;
+        }
         Alert.alert(
-          'Team needed',
-          `You need a ${item.sport === 'box_cricket' ? 'Cricket' : item.sport} team to challenge this squad. Create a team first!`,
+          `${formatLabel(fixtureFormat)} only`,
+          `${item.from_team_name} wants a ${formatLabel(fixtureFormat)} game, and teams can only play others of the same format. None of your squads is set to ${formatLabel(fixtureFormat)}.`,
           [
-            { text: 'Cancel', style: 'cancel' },
-            { text: 'Create Team', onPress: () => router.push('/teams/create') },
+            { text: 'Not now', style: 'cancel' },
+            {
+              text: 'Open team',
+              onPress: () =>
+                sameSport[0]
+                  ? router.push({ pathname: '/teams/[id]', params: { id: sameSport[0].id } })
+                  : router.push('/(tabs)/teams'),
+            },
           ],
         );
         return;
@@ -814,22 +853,12 @@
         </Pressable>
 
         {/*
-          Find a side.
-
-          Lives on Home rather than the Teams tab (moved 1 Sep): a player with no
-          squad has no reason to open Teams, which is exactly the person this is
-          for. Ghost styling so it reads as secondary to Create a Game.
+          "Find a team that needs players" stood here until 3 Sep 2026. It opened
+          the solo-player board, where an individual browsed squads and asked to
+          join one — the last route by which a player, rather than a squad,
+          entered team matchmaking. The board and its RPCs are gone; a player
+          joins a squad by invite code, and squads play squads.
         */}
-        <Pressable
-          style={styles.findTeamCta}
-          onPress={() => router.push('/teams/find-players')}
-          accessibilityRole="button"
-          accessibilityLabel="Find a team that needs players"
-        >
-          <AppText variant="label" color={M.text}>
-            Find a team that needs players
-          </AppText>
-        </Pressable>
 
         {/* ---------------- Sports ---------------- */}
         <SectionHead
@@ -890,23 +919,53 @@
           </ScrollView>
         )}
 
-        {/* ---------------- Match Offers (Looking for Opponents) ---------------- */}
+        {/* ---------------- Match Offers (Looking for Opponents) ----------------
+            Title carries the format, because the list is filtered by it. A rail
+            headed "GAME OFFERS" that quietly hides every other size is the
+            version of this screen that gets reported as a bug. */}
         <SectionHead
           M={M}
           styles={styles}
-          title="GAME OFFERS (LOOKING FOR OPPONENTS)"
+          title={
+            activeFormat.format !== null
+              ? `${formatLabel(activeFormat.format)} OFFERS (LOOKING FOR OPPONENTS)`
+              : 'GAME OFFERS (LOOKING FOR OPPONENTS)'
+          }
           actionLabel="See All"
           onAction={() => router.push('/(tabs)/matches')}
         />
-        {openChallenges.isLoading ? (
+        {activeFormat.reason === 'no_team' ? (
+          <View style={styles.card}>
+            <AppText variant="label" color={M.text}>
+              Create a team to see opponents
+            </AppText>
+            <AppText variant="caption" color={M.muted}>
+              Fixtures are squad against squad. Once you own a team and set how
+              many a side it plays, teams of that exact format show up here.
+            </AppText>
+          </View>
+        ) : activeFormat.reason === 'no_format' ? (
+          <View style={styles.card}>
+            <AppText variant="label" color={M.text}>
+              Set your team&apos;s format
+            </AppText>
+            <AppText variant="caption" color={M.muted}>
+              {`${activeFormat.teamName ?? 'Your team'} has not said how many a side it plays, so there is nothing to match it against.`}
+            </AppText>
+          </View>
+        ) : openChallenges.isLoading ? (
           <ActivityIndicator color={M.green} />
         ) : (openChallenges.data ?? []).length === 0 ? (
           <View style={styles.card}>
             <AppText variant="label" color={M.text}>
-              No open game offers nearby
+              {activeFormat.format !== null
+                ? `No ${formatLabel(activeFormat.format)} teams currently looking for a match in your area.`
+                : 'No open game offers nearby'}
             </AppText>
             <AppText variant="caption" color={M.muted}>
-              Post a game for your squad to invite and challenge nearby teams.
+              {activeFormat.format !== null
+                ? `You only see ${formatLabel(activeFormat.format)} fixtures, because that is what ${activeFormat.teamName ?? 'your team'} plays. Post your own and the radar will look for one.`
+                : 'Post a game for your squad to invite and challenge nearby teams.'}
             </AppText>
           </View>
         ) : (
@@ -945,7 +1004,7 @@
                       {c.from_team_name}
                     </AppText>
                     <AppText variant="caption" color={M.green} style={{ fontSize: 11 }}>
-                      {sportLabel(c.sport as Sport)} · View Profile & Stats →
+                      {`${sportLabel(c.sport as Sport)} · ${formatLabel(Math.max(Math.floor(c.total_slots / 2), 1))} · View Profile & Stats →`}
                     </AppText>
                   </View>
 
@@ -1411,16 +1470,6 @@
       alignItems: 'center',
       justifyContent: 'center',
     },
-    findTeamCta: {
-      marginHorizontal: S.md,
-      marginTop: S.sm,
-      minHeight: 48,
-      borderRadius: R.md,
-      borderWidth: 1,
-      borderColor: M.border,
-      alignItems: 'center',
-      justifyContent: 'center',
-    },
     sectionHead: {
       flexDirection: 'row',
       alignItems: 'center',
```

### app/(tabs)/matches.tsx
```diff
--- a/app/(tabs)/matches.tsx
+++ b/app/(tabs)/matches.tsx
@@ -34,6 +34,10 @@
   useNearbyOpenChallenges,
 } from '@features/teams/presentation/useChallenges';
 import { MatchOfferDetailModal } from '@features/teams/presentation/MatchOfferDetailModal';
+import {
+  formatLabel,
+  useActiveTeamFormat,
+} from '@features/teams/presentation/useActiveTeamFormat';
 import { useMyTeamsOverview } from '@features/teams/presentation/useTeams';
 import type { NearbyOpenChallenge } from '@features/teams/domain/challengeSchema';
 import { useSportLabel } from '@features/sports/presentation/useSports';
@@ -259,7 +263,18 @@
   const [radiusM, setRadiusM] = useState<number>(DEFAULT_SEARCH_RADIUS_M);
 
   const nearby = useNearbyMatches(coords, sport, radiusM);
-  const openChallenges = useNearbyOpenChallenges(coords, sport, radiusM);
+
+  /*
+    OPPONENTS ARE LOCKED TO ONE FORMAT.
+
+    The list below is not "teams near you", it is "teams near you playing your
+    number a side". A 4 v 4 squad sees 4 v 4 fixtures and nothing else, and the
+    filter is applied by `list_open_challenges_nearby` itself rather than here,
+    so an old build cannot widen it. This screen's job is to pass the format and
+    to say which format is showing -- an unexplained short list reads as a bug.
+  */
+  const activeFormat = useActiveTeamFormat(sport);
+  const openChallenges = useNearbyOpenChallenges(coords, sport, radiusM, activeFormat.format);
   const applyToChallenge = useApplyToChallenge();
   const myTeams = useMyTeamsOverview();
   const [challengingId, setChallengingId] = useState<string | null>(null);
@@ -300,17 +315,53 @@
 
   const onChallengeTeam = useCallback(
     (item: NearbyOpenChallenge) => {
+      // The fixture's format, from the one place it is ever derived.
+      const fixtureFormat = Math.max(Math.floor(item.total_slots / 2), 1);
+
+      /*
+        Same sport AND same format. The format clause is what makes this a
+        symmetric match rather than a suggestion: the server refuses a
+        cross-format request with FORMAT_MISMATCH, so offering a team that would
+        be refused is offering a button that cannot work.
+      */
       const ownedMatching = (myTeams.data ?? []).filter(
-        (t) => t.i_am_owner && (!item.sport || t.sport === item.sport),
+        (t) =>
+          t.i_am_owner &&
+          (!item.sport || t.sport === item.sport) &&
+          t.target_size === fixtureFormat,
       );
 
       if (ownedMatching.length === 0) {
+        // Two different problems, two different fixes. "You have no team" and
+        // "your team plays a different size" are not the same dead end.
+        const sameSport = (myTeams.data ?? []).filter(
+          (t) => t.i_am_owner && (!item.sport || t.sport === item.sport),
+        );
+        if (sameSport.length === 0) {
+          Alert.alert(
+            'Team needed',
+            `You need a ${item.sport === 'box_cricket' ? 'Cricket' : item.sport} team to challenge this squad. Create a team first!`,
+            [
+              { text: 'Cancel', style: 'cancel' },
+              { text: 'Create Team', onPress: () => router.push('/teams/create') },
+            ],
+          );
+          return;
+        }
         Alert.alert(
-          'Team needed',
-          `You need a ${item.sport === 'box_cricket' ? 'Cricket' : item.sport} team to challenge this squad. Create a team first!`,
+          `${formatLabel(fixtureFormat)} only`,
+          `${item.from_team_name} is looking for a ${formatLabel(fixtureFormat)} game. ` +
+            `Teams can only play others of the same format, and none of your squads is set to ` +
+            `${formatLabel(fixtureFormat)}. Change a team's format on its page to challenge this fixture.`,
           [
-            { text: 'Cancel', style: 'cancel' },
-            { text: 'Create Team', onPress: () => router.push('/teams/create') },
+            { text: 'Not now', style: 'cancel' },
+            {
+              text: 'Open team',
+              onPress: () =>
+                sameSport[0]
+                  ? router.push({ pathname: '/teams/[id]', params: { id: sameSport[0].id } })
+                  : router.push('/(tabs)/teams'),
+            },
           ],
         );
         return;
@@ -637,14 +688,64 @@
         </Pressable>
       ) : null}
 
-      {/* Open Team Challenges (Looking for Opponents) */}
+      {/*
+        Open Team Challenges, LOCKED to the caller's format.
+
+        Three states, and each says something different, because an empty
+        opponent list has three completely different fixes: create a team,
+        declare a format, or wait for a same-format fixture. Collapsing them into
+        one "nothing here" is what makes strict matching feel broken.
+      */}
+      {activeFormat.reason === 'no_team' ? null : activeFormat.reason === 'no_format' ? (
+        <View style={styles.challengeSection}>
+          <View style={styles.formatEmpty}>
+            <AppText variant="label" color={M.text}>
+              Set your team&apos;s format
+            </AppText>
+            <AppText variant="caption" color={M.muted}>
+              {`${activeFormat.teamName ?? 'Your team'} has not said how many a side it plays, so there is nothing to match it against. Pick a format on the team page and opponents of that exact size appear here.`}
+            </AppText>
+            <ScalePressable
+              onPress={() =>
+                activeFormat.teamId
+                  ? router.push({ pathname: '/teams/[id]', params: { id: activeFormat.teamId } })
+                  : router.push('/(tabs)/teams')
+              }
+              style={styles.retryBtn}
+            >
+              <AppText variant="label" color={M.ctaText}>
+                Set format
+              </AppText>
+            </ScalePressable>
+          </View>
+        </View>
+      ) : activeFormat.format !== null &&
+        !openChallenges.isLoading &&
+        (openChallenges.data?.length ?? 0) === 0 ? (
+        <View style={styles.challengeSection}>
+          <View style={styles.formatEmpty}>
+            <AppText variant="label" color={M.text}>
+              {`No ${formatLabel(activeFormat.format)} teams looking for a match in your area.`}
+            </AppText>
+            <AppText variant="caption" color={M.muted}>
+              {`You only see ${formatLabel(activeFormat.format)} fixtures, because that is what ${activeFormat.teamName ?? 'your team'} plays. Widen the search distance above, or post your own ${formatLabel(activeFormat.format)} and let the radar find an opponent.`}
+            </AppText>
+            <ScalePressable onPress={goCreate} style={styles.retryBtn}>
+              <AppText variant="label" color={M.ctaText}>
+                {`Post a ${formatLabel(activeFormat.format)}`}
+              </AppText>
+            </ScalePressable>
+          </View>
+        </View>
+      ) : null}
+
       {openChallenges.data && openChallenges.data.length > 0 ? (
         <View style={styles.challengeSection}>
           <View style={styles.sectionHeaderRow}>
             <View style={styles.challengeSectionPill}>
               <View style={styles.challengeSectionDot} />
               <AppText variant="caption" color={M.limeInk} style={{ fontWeight: '800', fontSize: 11 }}>
-                TEAMS LOOKING FOR OPPONENTS ({openChallenges.data.length})
+                {`${activeFormat.format !== null ? `${formatLabel(activeFormat.format)} ` : ''}TEAMS LOOKING FOR OPPONENTS (${openChallenges.data.length})`}
               </AppText>
             </View>
           </View>
@@ -679,7 +780,8 @@
                         {item.from_team_name}
                       </AppText>
                       <AppText variant="caption" color={M.muted}>
-                        {item.sport === 'box_cricket' ? '🏏 Cricket' : '🏸 Badminton'} · {item.total_slots} slots
+                        {item.sport === 'box_cricket' ? '🏏 Cricket' : '🏸 Badminton'} ·{' '}
+                        {formatLabel(Math.max(Math.floor(item.total_slots / 2), 1))}
                       </AppText>
                     </View>
                   </View>
@@ -892,6 +994,20 @@
   },
   listHeading: { fontSize: 16, marginBottom: S.sm },
   notice: { alignItems: 'center', gap: S.md, paddingVertical: S.xl },
+  /*
+    The format empty states. Bordered card rather than plain muted text: this is
+    the screen telling the user WHY the list is short, and it has to read as
+    information about the filter, not as a failed fetch.
+  */
+  formatEmpty: {
+    gap: S.sm,
+    padding: S.md,
+    borderRadius: R.lg,
+    borderWidth: 1,
+    borderColor: M.border,
+    backgroundColor: M.card,
+    alignItems: 'flex-start',
+  },
   retryBtn: {
     minHeight: 44,
     paddingHorizontal: S.lg,
```

### app/teams/[id]/index.tsx
```diff
--- a/app/teams/[id]/index.tsx
+++ b/app/teams/[id]/index.tsx
@@ -4,7 +4,7 @@
 import { useSportLabel } from '@features/sports/presentation/useSports';
 import { TEAM_ROLE_LABEL } from '@features/teams/domain/teamSchema';
 import { useMyChallenges } from '@features/teams/presentation/useChallenges';
-import { useJoinRequests, useSetTeamTargetSize } from '@features/teams/presentation/useRecruit';
+import { useSetTeamFormat } from '@features/teams/presentation/useRecruit';
 import {
   useSetMemberRole,
   useTeamFixtures,
@@ -35,10 +35,7 @@
   const members = useTeamMembers(teamId);
   const stats = useTeamStats(teamId);
   const fixtures = useTeamFixtures(teamId);
-  // The same RPC the inbox uses; it already refuses anyone who is not captain.
-  const joinRequests = useJoinRequests(teamId);
-  const pendingRequests = (joinRequests.data ?? []).length;
-  const setTargetSize = useSetTeamTargetSize(teamId);
+  const setTeamFormat = useSetTeamFormat(teamId);
   const setRole = useSetMemberRole(teamId);
   const memberActions = useTeamMemberActions(teamId);
   const challenges = useMyChallenges();
@@ -256,54 +253,66 @@
                 </View>
               </View>
               {/*
-                Recruiting.
+                FORMAT.
 
-                A team is invisible to solo players until the captain says how
-                big the squad should be: list_teams_needing_players only returns
-                rows where target_size is not null and the squad is under it.
-                Tapping the lit size again turns recruiting off.
+                `target_size` used to mean "recruiting to N players" and put the
+                team on the solo-player Find Players board. That board is gone
+                (3 Sep 2026); the column now declares the format the squad plays
+                -- 6 means "we are a 6 v 6 side" -- and it is the single value
+                strict matchmaking filters on at both ends. Undeclared is not a
+                wildcard: it is invisible, in both directions, which is why the
+                empty state says so plainly.
+
+                A format larger than the current squad is refused server-side
+                (SQUAD_TOO_SMALL_FOR_FORMAT), so sizes the team cannot field are
+                shown disabled rather than as a tap that fails.
               */}
               <AppText variant="label" style={{ marginTop: spacing.sm }}>
-                Looking for players?
+                Format
               </AppText>
               <AppText variant="caption" muted>
                 {team.target_size
-                  ? `Listed to nearby players — squad of ${team.target_size}, ${Math.max(team.target_size - team.player_count, 0)} still needed.`
-                  : 'Set a squad size and your team shows up to players looking for a side.'}
+                  ? `${team.target_size} v ${team.target_size}. You are only shown ${team.target_size} v ${team.target_size} opponents, and only they can challenge you.`
+                  : 'Pick how many a side you play. Until you do, this team is not shown to any opponent and cannot see any fixtures.'}
               </AppText>
               <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                 {[4, 6, 8, 10, 12].map((n) => {
                   const on = team.target_size === n;
+                  const canField = team.player_count >= n;
                   return (
                     <Pressable
                       key={n}
-                      onPress={() => setTargetSize.mutate(on ? null : n)}
-                      disabled={setTargetSize.isPending}
+                      onPress={() => setTeamFormat.mutate(on ? null : n)}
+                      disabled={setTeamFormat.isPending || (!on && !canField)}
                       accessibilityRole="button"
-                      accessibilityState={{ selected: on }}
-                      accessibilityLabel={on ? `Stop recruiting` : `Recruit to ${n} players`}
+                      accessibilityState={{ selected: on, disabled: !on && !canField }}
+                      accessibilityLabel={
+                        on
+                          ? `Clear the ${n} a side format`
+                          : canField
+                            ? `Play ${n} a side`
+                            : `${n} a side needs ${n} players, this team has ${team.player_count}`
+                      }
                       style={{
                         paddingHorizontal: spacing.md,
                         paddingVertical: 6,
                         borderRadius: radius.sm,
                         borderWidth: 1,
+                        opacity: !on && !canField ? 0.4 : 1,
                         borderColor: on ? colors.primary : colors.border,
                       }}
                     >
                       <AppText variant="caption" color={on ? colors.primary : colors.textMuted}>
-                        {n}
+                        {`${n} v ${n}`}
                       </AppText>
                     </Pressable>
                   );
                 })}
               </View>
-              <Button
-                label={`Join requests${pendingRequests > 0 ? ` (${pendingRequests})` : ''}`}
-                variant="secondary"
-                onPress={() =>
-                  router.push({ pathname: '/teams/[id]/requests', params: { id: teamId } })
-                }
-              />
+              <AppText variant="caption" muted>
+                Short of players? Share the invite code — a squad grows by
+                invitation now, not by strangers asking to join.
+              </AppText>
             </View>
           ) : null}
         </View>
```

### app/match/create/details.tsx
```diff
--- a/app/match/create/details.tsx
+++ b/app/match/create/details.tsx
@@ -29,7 +29,7 @@
  * search distance — is identical on both branches and is written once.
  */
 import { useEffect, useMemo, useState } from 'react';
-import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
+import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
 import { useRouter } from 'expo-router';
 
 import { AppError } from '@core/errors/AppError';
@@ -56,7 +56,7 @@
 import { PostOpenChallengeSchema } from '@features/teams/domain/challengeSchema';
 import { usePostOpenChallenge } from '@features/teams/presentation/useChallenges';
 import { useMyTeamsOverview } from '@features/teams/presentation/useTeams';
-import { useSetTeamTargetSize } from '@features/teams/presentation/useRecruit';
+import { useSetTeamFormat } from '@features/teams/presentation/useRecruit';
 import type { Sport } from '@shared/types/database.types';
 import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
 import { AppText } from '@shared/ui/AppText';
@@ -142,7 +142,6 @@
   const post = usePostOpenChallenge(teamId ?? '');
   // Post a Match: no team anywhere in the payload.
   const createOpen = useCreateOpenMatch();
-  const submitting = isOpenMatch ? createOpen.isPending : post.isPending;
   const teams = useMyTeamsOverview();
   const sportLabel = useSportLabel();
 
@@ -158,37 +157,31 @@
     [ownedTeams, teamId],
   );
 
-  const setTargetSize = useSetTeamTargetSize(teamId ?? '');
+  const setTeamFormat = useSetTeamFormat(teamId ?? '');
+  // The format re-declaration is part of the same submit, so the button has to
+  // stay busy through it or a second tap fires a second post. Declared after
+  // the mutation it reads, not above it.
+  const submitting = isOpenMatch
+    ? createOpen.isPending
+    : post.isPending || setTeamFormat.isPending;
 
   /*
-    "Find players" PUBLISHES the opening rather than just navigating.
+    THE FORMAT IS THE TEAM'S, and this screen may change it.
 
-    It used to push straight to the inbox, which was empty and said "set a squad
-    size on the team page" -- telling the captain to go and do the thing the
-    button should have done. Setting target_size is what makes the team appear
-    in list_teams_needing_players, so this posts the opening at the size the
-    wizard already knows, then shows the inbox it will fill.
+    Strict format-to-format matchmaking judges every team by one number --
+    `teams.target_size`, its declared players per side -- on both sides of every
+    fixture. So a captain who posts a 6 v 6 from a team declared as 4 v 4 would
+    be asking for opponents by a yardstick their own team fails; the server
+    refuses that insert with FORMAT_MISMATCH rather than quietly allowing the
+    asymmetry.
+
+    The override still exists, it is just honest: picking a different size here
+    re-declares the team's format first, then posts. That is one extra write on
+    the uncommon path and none on the common one.
   */
-  const onFindPlayers = (): void => {
-    if (!teamId || playersPerSide === null) return;
-    setTargetSize.mutate(playersPerSide, {
-      onSuccess: () => {
-        router.push({
-          pathname: '/match/create/player-searching',
-          params: {
-            teamId,
-            targetSize: String(playersPerSide),
-            shortBy: String(shortBy),
-          },
-        });
-      },
-      onError: (e: unknown) =>
-        Alert.alert(
-          'Could not post opening',
-          e instanceof Error ? e.message : 'Please try again.',
-        ),
-    });
-  };
+  const teamFormat = team?.target_size ?? null;
+  const formatChanged =
+    !isOpenMatch && playersPerSide !== null && teamFormat !== null && playersPerSide !== teamFormat;
 
   // Only meaningful for a team fixture; an open game is filled by individuals.
   const shortBy =
@@ -204,6 +197,20 @@
     }
   }, [isOpenMatch, teamId, ownedTeams, setTeamId]);
 
+  /*
+    The team's own format is the default answer, not an empty chip row.
+
+    A squad that has declared itself 6 v 6 is almost always posting a 6 v 6, and
+    leaving the question blank invites the one answer that costs an extra write
+    and a re-declaration. Only pre-fills an unanswered form -- an explicit
+    choice, including a deliberate override, is never overwritten.
+  */
+  useEffect(() => {
+    if (!isOpenMatch && playersPerSide === null && teamFormat !== null) {
+      setPlayersPerSide(teamFormat);
+    }
+  }, [isOpenMatch, playersPerSide, teamFormat, setPlayersPerSide]);
+
   const sizeOptions = sport ? PLAYERS_PER_SIDE[sport] : [];
   const totalSlots = playersPerSide !== null ? playersPerSide * 2 : 0;
   const time = parseHHmm(timeHHmm);
@@ -346,6 +353,18 @@
     }
 
     try {
+      /*
+        Re-declare first, post second, and never the other way round.
+
+        The insert trigger on team_challenges compares the fixture's format with
+        the posting team's, so posting first would simply fail. Awaited rather
+        than fired and forgotten: if the re-declaration is refused (a squad too
+        small for the size just picked), the post must not happen at all.
+      */
+      if (formatChanged && playersPerSide !== null) {
+        await setTeamFormat.mutateAsync(playersPerSide);
+      }
+
       const challenge = await post.mutateAsync({
         matchName: derivedName,
         areaName,
@@ -631,9 +650,9 @@
           </View>
           {/*
             Short squad BLOCKS a team fixture (the submit guard refuses it too;
-            this is the explanation, not the boundary). Two ways out: recruit
-            strangers through Find Players, or share the invite code with people
-            you already know.
+            this is the explanation, not the boundary). One way out now: the
+            invite code. The Find Players board — strangers asking to join a
+            squad — was removed on 3 Sep 2026, so a squad grows by invitation.
           */}
           {shortBy > 0 ? (
             <View style={styles.squadWarn}>
@@ -645,28 +664,39 @@
               </AppText>
               <View style={styles.squadWarnRow}>
                 <Pressable
-                  onPress={() => onFindPlayers()}
-                  disabled={setTargetSize.isPending}
-                  accessibilityRole="button"
-                  style={styles.squadWarnBtn}
-                >
-                  <AppText variant="caption" color={M.green} style={{ fontWeight: '700' }}>
-                    {setTargetSize.isPending ? 'Posting…' : 'Find players'}
-                  </AppText>
-                </Pressable>
-                <Pressable
                   onPress={() => router.push(`/teams/${teamId}/invite`)}
                   accessibilityRole="button"
                   style={styles.squadWarnBtn}
                 >
                   <AppText variant="caption" color={M.green} style={{ fontWeight: '700' }}>
-                    Invite by code
+                    Invite players by code
                   </AppText>
                 </Pressable>
               </View>
             </View>
           ) : null}
 
+          {/*
+            Says out loud that this size is a FILTER, not a preference — the one
+            thing about strict matching a captain has to understand before they
+            wonder where all the teams went.
+          */}
+          {!isOpenMatch && playersPerSide !== null ? (
+            <View style={styles.formatNote}>
+              <AppText variant="caption" color={M.green} center>
+                {`You will only be shown ${playersPerSide} v ${playersPerSide} teams, and only they can challenge you.`}
+              </AppText>
+            </View>
+          ) : null}
+
+          {/* An override re-declares the team's format. Said before the submit,
+              not discovered after it. */}
+          {formatChanged ? (
+            <AppText variant="caption" color={M.muted} style={styles.helper}>
+              {`${team?.name ?? 'Your team'} is set to ${teamFormat} v ${teamFormat}. Posting this changes it to ${playersPerSide} v ${playersPerSide} for future games too.`}
+            </AppText>
+          ) : null}
+
           <AppText variant="caption" color={M.faint} style={styles.helper}>
             {playersPerSide === null
               ? isOpenMatch
@@ -823,6 +853,14 @@
       borderColor: M.border,
       marginTop: S.sm,
     },
+    formatNote: {
+      marginTop: S.sm,
+      padding: S.sm,
+      borderRadius: R.md,
+      borderWidth: 1,
+      borderColor: M.green,
+      backgroundColor: M.iconChip,
+    },
     squadWarnRow: { flexDirection: 'row', gap: S.md },
     squadWarnBtn: { alignSelf: 'flex-start', paddingVertical: S.xs },
     helper: { marginTop: S.sm },
```

### app/match/create/searching.tsx
```diff
--- a/app/match/create/searching.tsx
+++ b/app/match/create/searching.tsx
@@ -510,7 +510,18 @@
     });
   }, []);
 
-  const nearbyOpenChallenges = useNearbyOpenChallenges(coords, currentTeam?.sport);
+  /*
+    The radar's "other fixtures nearby" rail is format-locked to the team whose
+    search this is. Same rule as the Games tab, same server-side filter: a 4 v 4
+    squad is shown 4 v 4 fixtures, because those are the only ones
+    apply_to_open_challenge would let it request.
+  */
+  const nearbyOpenChallenges = useNearbyOpenChallenges(
+    coords,
+    currentTeam?.sport,
+    undefined,
+    currentTeam?.target_size ?? null,
+  );
   const myOffers = useMyOffers();
   const applyToChallenge = useApplyToChallenge();
   const [requestingChallengeId, setRequestingChallengeId] = useState<string | null>(null);
@@ -595,7 +606,17 @@
       return;
     }
 
-    const perSide = DEFAULT_PLAYERS_PER_SIDE[currentTeam.sport] ?? 6;
+    /*
+      The team's DECLARED format, not a per-sport default.
+
+      The insert trigger on team_challenges compares the fixture's format with
+      the posting team's, so a broadcast at the sport's default size would be
+      refused outright for any team that plays something else. The constant is
+      kept only as the fallback for a team with no declared format — and that
+      post will be refused too, with FORMAT_MISMATCH, which is the correct
+      answer: declare a format first.
+    */
+    const perSide = currentTeam.target_size ?? DEFAULT_PLAYERS_PER_SIDE[currentTeam.sport] ?? 6;
     const totalSlots = perSide * 2;
     const curCoords = await getCurrentCoords();
     const areaName = (profile?.area_name || currentTeam.home_ground || 'Local Area').trim();
@@ -676,20 +697,36 @@
 
   const onSendMatchRequest = useCallback(
     (item: NearbyOpenChallenge) => {
-      // Find a squad owned by the user that matches this fixture's sport
+      /*
+        A squad owned by the user that matches this fixture's sport AND its
+        format. Format is not a tie-break here, it is a requirement: the server
+        refuses a cross-format request with FORMAT_MISMATCH, so a squad that
+        fails it is not a fallback, it is a guaranteed error.
+      */
+      const fixtureFormat = Math.max(Math.floor(item.total_slots / 2), 1);
+      const eligible = ownedTeams.filter(
+        (t) => t.sport === item.sport && t.target_size === fixtureFormat,
+      );
       const matchingTeam =
-        ownedTeams.find((t) => t.id === currentTeam?.id && t.sport === item.sport) ??
-        ownedTeams.find((t) => t.sport === item.sport);
+        eligible.find((t) => t.id === currentTeam?.id) ?? eligible[0] ?? null;
 
       if (!matchingTeam) {
         const sportName = item.sport === 'box_cricket' ? 'Box Cricket' : item.sport;
+        const sameSport = ownedTeams.filter((t) => t.sport === item.sport);
+        if (sameSport.length === 0) {
+          Alert.alert(
+            'Matching Squad Needed',
+            `This match fixture requires a ${sportName} squad. Please create or pick a ${sportName} team to send this request.`,
+            [
+              { text: 'Cancel', style: 'cancel' },
+              { text: 'Create Team', onPress: () => router.push('/teams/create') },
+            ],
+          );
+          return;
+        }
         Alert.alert(
-          'Matching Squad Needed',
-          `This match fixture requires a ${sportName} squad. Please create or pick a ${sportName} team to send this request.`,
-          [
-            { text: 'Cancel', style: 'cancel' },
-            { text: 'Create Team', onPress: () => router.push('/teams/create') },
-          ],
+          `${fixtureFormat} v ${fixtureFormat} only`,
+          `${item.from_team_name} is looking for a ${fixtureFormat} v ${fixtureFormat} game. Teams can only play others of the same format, and none of your ${sportName} squads is set to ${fixtureFormat} a side.`,
         );
         return;
       }
```

### app/teams/offers.tsx
```diff
--- a/app/teams/offers.tsx
+++ b/app/teams/offers.tsx
@@ -346,6 +346,30 @@
   const onSendRequest = useCallback(
     (offer: OpenOffer) => {
       if (!offer.challenge) return;
+
+      /*
+        Last client-side gate before apply_to_open_challenge.
+
+        The RPC and the challenge_candidates trigger both refuse a cross-format
+        request, so this changes no outcome — it changes the message. "Teams can
+        only play the same format" is actionable; a generic failure alert after a
+        round trip is not. The offer row itself carries the fixture's format, and
+        the team's comes from the same read model the card renders.
+      */
+      const fixtureFormat = Math.max(Math.floor(offer.challenge.total_slots / 2), 1);
+      const myTeam = myTeamById.get(offer.team_id);
+      if (myTeam && myTeam.target_size !== fixtureFormat) {
+        Alert.alert(
+          `${fixtureFormat} v ${fixtureFormat} only`,
+          `This fixture is ${fixtureFormat} v ${fixtureFormat}. ${myTeam.name} plays ${
+            myTeam.target_size !== null
+              ? `${myTeam.target_size} v ${myTeam.target_size}`
+              : 'no declared format'
+          }, and teams can only play others of the same format.`,
+        );
+        return;
+      }
+
       setPendingId(offer.id);
       applyToChallenge.mutate(
         { challengeId: offer.challenge_id, teamId: offer.team_id },
@@ -368,7 +392,7 @@
         },
       );
     },
-    [applyToChallenge, offers],
+    [applyToChallenge, offers, myTeamById],
   );
 
   /**
@@ -464,8 +488,11 @@
           <AppText variant="caption" color={M.muted}>
             {formatWhen(item.challenge.scheduled_at)}
           </AppText>
+          {/* The format, not the sheet total. It is the field that decides
+              whether this offer is even legal for the squad below, so it reads
+              as "4 v 4" rather than "8 players". */}
           <AppText variant="caption" color={M.muted}>
-            {formatDistance(item.distance_m)} · {item.challenge.total_slots} players
+            {`${formatDistance(item.distance_m)} · ${Math.max(Math.floor(item.challenge.total_slots / 2), 1)} v ${Math.max(Math.floor(item.challenge.total_slots / 2), 1)}`}
           </AppText>
 
           {team ? (
```

### src/features/teams/presentation/useRecruit.ts
```diff
--- a/src/features/teams/presentation/useRecruit.ts
+++ b/src/features/teams/presentation/useRecruit.ts
@@ -1,70 +1,44 @@
-import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
+/**
+ * What is left of the recruiting module: the team's FORMAT, and nothing else.
+ *
+ * `target_size` used to mean "recruiting to N players", which is what put a
+ * team on the solo-player Find Players board. That board is gone (3 Sep 2026)
+ * along with `list_teams_needing_players`, `request_to_join_team` and the
+ * captain's join-request inbox: a player joins a squad by invite code, and a
+ * squad plays another squad. Nothing in the app lets an individual queue for,
+ * search for or join a Team vs Team fixture any more.
+ *
+ * The column survives with a new job. `target_size` is now the team's DEFAULT
+ * FORMAT -- a 6 means "we are a 6 v 6 side" -- and it is what strict
+ * format-to-format matchmaking filters on: `rank_challenge_candidates` and
+ * `list_open_challenges_nearby` compare it to the fixture's `total_slots / 2`
+ * and refuse anything else. A captain may still override the format for one
+ * fixture in the create wizard; the opponent list re-locks to whatever that
+ * fixture asked for.
+ */
+import { useMutation, useQueryClient } from '@tanstack/react-query';
 
-import type { Coords } from '@core/location/location';
 import { recruitRepository } from '@features/teams/data/recruitRepository';
 
-export const openingsKey = (
-  coords: Coords | null,
-  sport: string | null,
-  radiusM: number,
-) => ['teams', 'openings', coords?.lat ?? 0, coords?.lng ?? 0, sport ?? 'all', radiusM] as const;
-
-export const joinRequestsKey = (teamId: string) =>
-  ['teams', 'join-requests', teamId] as const;
-
-export function useTeamOpenings(
-  coords: Coords | null,
-  sport: string | null,
-  radiusM: number,
-) {
-  return useQuery({
-    queryKey: openingsKey(coords, sport, radiusM),
-    queryFn: () =>
-      recruitRepository.openings({
-        lat: coords?.lat ?? null,
-        lng: coords?.lng ?? null,
-        radiusM,
-        sport,
-      }),
-  });
-}
-
-export function useRequestToJoinTeam() {
-  const qc = useQueryClient();
-  return useMutation({
-    mutationFn: ({ teamId, message }: { teamId: string; message: string | null }) =>
-      recruitRepository.requestToJoin(teamId, message),
-    // The row carries my_request_status, so the list itself changes.
-    onSuccess: () => void qc.invalidateQueries({ queryKey: ['teams', 'openings'] }),
-  });
-}
-
-export function useJoinRequests(teamId: string) {
-  return useQuery({
-    queryKey: joinRequestsKey(teamId),
-    queryFn: () => recruitRepository.listRequests(teamId),
-    enabled: teamId.length > 0,
-  });
-}
-
-export function useRespondToJoinRequest(teamId: string) {
+/**
+ * Set the team's default format (players per side), or null to clear it.
+ *
+ * Invalidates every `teams` read: the format is rendered on the team page, is
+ * the create wizard's default squad size, and decides which fixtures the team
+ * can see at all, so a stale copy is a wrong opponent list rather than a
+ * cosmetic lag.
+ */
+export function useSetTeamFormat(teamId: string) {
   const qc = useQueryClient();
   return useMutation({
-    mutationFn: ({ requestId, accept }: { requestId: string; accept: boolean }) =>
-      recruitRepository.respond(requestId, accept),
+    mutationFn: (playersPerSide: number | null) =>
+      recruitRepository.setTeamFormat(teamId, playersPerSide),
     onSuccess: () => {
-      void qc.invalidateQueries({ queryKey: joinRequestsKey(teamId) });
-      // Accepting adds a member, so every squad-size read moves with it --
-      // including the create wizard's gate on player_count.
       void qc.invalidateQueries({ queryKey: ['teams'] });
+      // Discovery is keyed on the format, so both lists must be re-fetched or
+      // the team keeps seeing the old format's opponents.
+      void qc.invalidateQueries({ queryKey: ['challenges', 'nearby'] });
+      void qc.invalidateQueries({ queryKey: ['challenge'] });
     },
   });
 }
-
-export function useSetTeamTargetSize(teamId: string) {
-  const qc = useQueryClient();
-  return useMutation({
-    mutationFn: (size: number | null) => recruitRepository.setTargetSize(teamId, size),
-    onSuccess: () => void qc.invalidateQueries({ queryKey: ['teams'] }),
-  });
-}
```

### src/features/teams/data/recruitRepository.ts
```diff
--- a/src/features/teams/data/recruitRepository.ts
+++ b/src/features/teams/data/recruitRepository.ts
@@ -1,95 +1,55 @@
 import { supabase } from '@core/api/supabaseClient';
 import { AppError, toAppError } from '@core/errors/AppError';
 import type { AppErrorCode } from '@core/errors/AppError';
-import type { Database } from '@shared/types/database.types';
-
-export type TeamOpening =
-  Database['public']['Functions']['list_teams_needing_players']['Returns'][number];
-export type JoinRequest =
-  Database['public']['Functions']['list_team_join_requests']['Returns'][number];
 
 /**
- * Find Players.
+ * Team FORMAT, and nothing else.
+ *
+ * This file used to be the solo-player recruiting surface: `openings()` listed
+ * teams to strangers, `requestToJoin()` queued a stranger against a squad and
+ * `listRequests()` / `respond()` were the captain's inbox for those requests.
+ * All four are gone with the Find Players board (3 Sep 2026), and so are the
+ * RPCs behind them -- `list_teams_needing_players`, `request_to_join_team`,
+ * `list_team_join_requests` and `respond_to_join_request` are dropped in
+ * `20260903090000_squad_only_matchmaking.sql`.
  *
- * A captain sets `target_size` to start recruiting; the team then shows to solo
- * players as an opening with N slots left. Writes all go through RPCs -- there
- * is no INSERT/UPDATE policy on `team_join_requests` -- so every refusal below
- * comes back as a stable token rather than a Postgres error the user would see.
+ * `set_team_target_size` survives because the column it writes has a second,
+ * load-bearing job: it is the team's declared format, and strict
+ * format-to-format matchmaking reads it on both sides of every fixture.
  */
-const RECRUIT_ERRORS: [string, AppErrorCode, string][] = [
-  ['NOT_THE_CAPTAIN', 'unauthorized', 'Only the team captain can do that.'],
+const FORMAT_ERRORS: [string, AppErrorCode, string][] = [
+  ['NOT_THE_CAPTAIN', 'unauthorized', 'Only the team captain can set the format.'],
   ['TEAM_NOT_FOUND', 'not_found', 'That team no longer exists.'],
-  ['TEAM_NOT_RECRUITING', 'conflict', 'That team is not looking for players right now.'],
-  ['TEAM_FULL', 'conflict', 'That squad is already full.'],
-  ['ALREADY_A_MEMBER', 'conflict', 'You are already in that team.'],
-  ['REQUEST_ALREADY_SENT', 'conflict', 'You have already asked to join. Wait for the captain.'],
-  ['REQUEST_ALREADY_ANSWERED', 'conflict', 'That request has already been answered.'],
-  ['REQUEST_NOT_FOUND', 'not_found', 'That request no longer exists.'],
-  ['INVALID_SQUAD_SIZE', 'validation', 'Pick a squad size between 2 and 20.'],
+  ['INVALID_SQUAD_SIZE', 'validation', 'Pick a format between 2 and 20 players a side.'],
+  [
+    'FORMAT_BELOW_SQUAD',
+    'validation',
+    'That format is smaller than your current squad. Remove players first, or pick a bigger format.',
+  ],
   ['ACCOUNT_INACTIVE', 'unauthorized', 'Your account is not active.'],
 ];
 
-function recruitError(error: unknown): AppError {
+function formatError(error: unknown): AppError {
   const message = error instanceof Error ? error.message : String(error);
-  for (const [token, code, friendly] of RECRUIT_ERRORS) {
+  for (const [token, code, friendly] of FORMAT_ERRORS) {
     if (message.includes(token)) return new AppError(code, friendly);
   }
   return toAppError(error);
 }
 
 export const recruitRepository = {
-  /** Start recruiting to a squad size, or pass null to stop. */
-  async setTargetSize(teamId: string, size: number | null): Promise<void> {
-    const { error } = await supabase.rpc('set_team_target_size', {
-      in_team_id: teamId,
-      in_size: size,
-    });
-    if (error) throw recruitError(error);
-  },
-
   /**
-   * Teams with room. Distance is measured from the CAPTAIN's profile
-   * coordinates -- teams have no coordinates of their own, only a free-text
-   * home_ground -- and a captain without coords still lists rather than being
-   * hidden over missing metadata.
+   * Declare the team's format in players PER SIDE, or null to clear it.
+   *
+   * A team with no format is invisible to matchmaking in both directions: the
+   * radar cannot rank it as a candidate and it cannot see anybody's fixtures,
+   * because "any format" is exactly what strict matching refuses to allow.
    */
-  async openings(input: {
-    lat?: number | null;
-    lng?: number | null;
-    radiusM?: number;
-    sport?: string | null;
-  }): Promise<TeamOpening[]> {
-    const { data, error } = await supabase.rpc('list_teams_needing_players', {
-      in_lat: input.lat ?? null,
-      in_lng: input.lng ?? null,
-      in_radius_m: input.radiusM ?? 25000,
-      in_sport: input.sport ?? null,
-    });
-    if (error) throw recruitError(error);
-    return data ?? [];
-  },
-
-  async requestToJoin(teamId: string, message: string | null): Promise<void> {
-    const { error } = await supabase.rpc('request_to_join_team', {
-      in_team_id: teamId,
-      in_message: message,
-    });
-    if (error) throw recruitError(error);
-  },
-
-  async listRequests(teamId: string): Promise<JoinRequest[]> {
-    const { data, error } = await supabase.rpc('list_team_join_requests', {
+  async setTeamFormat(teamId: string, playersPerSide: number | null): Promise<void> {
+    const { error } = await supabase.rpc('set_team_target_size', {
       in_team_id: teamId,
+      in_size: playersPerSide,
     });
-    if (error) throw recruitError(error);
-    return data ?? [];
-  },
-
-  async respond(requestId: string, accept: boolean): Promise<void> {
-    const { error } = await supabase.rpc('respond_to_join_request', {
-      in_request_id: requestId,
-      in_accept: accept,
-    });
-    if (error) throw recruitError(error);
+    if (error) throw formatError(error);
   },
 };
```

### src/features/teams/data/challengeRepository.ts
```diff
--- a/src/features/teams/data/challengeRepository.ts
+++ b/src/features/teams/data/challengeRepository.ts
@@ -42,6 +42,20 @@
     'That team does not have enough players for this many a side yet.',
   ],
   ['SQUAD_TOO_SMALL', 'conflict', 'Your squad is too small for that many players a side. Add players first.'],
+  // Strict format matching (20260903090000). ORDER MATTERS for the same reason
+  // the squad tokens above are ordered: 'OPPONENT_FORMAT_MISMATCH' contains
+  // 'FORMAT_MISMATCH', so the opponent-specific token has to be tested first or
+  // a cross-format OPPONENT is reported as the user's own team being wrong.
+  [
+    'OPPONENT_FORMAT_MISMATCH',
+    'conflict',
+    'That team plays a different format. Teams can only play the same number a side.',
+  ],
+  [
+    'FORMAT_MISMATCH',
+    'conflict',
+    'That fixture is a different format from your team. You can only play teams of the same number a side.',
+  ],
   ['SPORT_MISMATCH', 'validation', 'That team plays a different sport.'],
   ['SCHEDULE_IN_PAST', 'validation', 'Pick a date and time in the future.'],
   ['TOO_MANY_PLAYERS', 'validation', 'Both squads together do not fit the slots you picked.'],
@@ -192,17 +206,31 @@
   /**
    * Opponent teams browse open fixtures looking for opponents nearby.
    */
+  /**
+   * Open fixtures near me, LOCKED to one format.
+   *
+   * `teamSize` is players per side and is not optional in spirit even though
+   * the type allows null: `list_open_challenges_nearby` returns nothing at all
+   * for a null, because "I have not told you my format" is not a wildcard. The
+   * caller passes the active team's declared format and renders a
+   * format-specific empty state when there is nothing at that size.
+   */
   async listNearbyOpenChallenges(input?: {
     lat?: number | null;
     lng?: number | null;
     radiusM?: number;
     sport?: string | null;
+    teamSize?: number | null;
   }): Promise<NearbyOpenChallenge[]> {
+    // Saves a round trip on the commonest case: a user with no team, or a team
+    // whose captain has not declared a format, can match nobody.
+    if (input?.teamSize == null) return [];
     const { data, error } = await supabase.rpc('list_open_challenges_nearby', {
       in_lat: input?.lat ?? null,
       in_lng: input?.lng ?? null,
       in_radius_m: input?.radiusM ?? 50000,
       in_sport: input?.sport ?? null,
+      in_team_size: input.teamSize,
     });
     if (error) throw challengeError(error);
     return (data ?? []) as NearbyOpenChallenge[];
```

### src/features/teams/presentation/useChallenges.ts
```diff
--- a/src/features/teams/presentation/useChallenges.ts
+++ b/src/features/teams/presentation/useChallenges.ts
@@ -228,16 +228,25 @@
 }
 
 /**
- * Opponent teams browse open fixtures in their area looking for matches.
+ * Opponent teams browse open fixtures in their area, LOCKED to one format.
+ *
+ * `teamSize` is players per side and is the whole point of this hook now: a
+ * 4 v 4 side sees 4 v 4 fixtures and nothing else, server-side, with no client
+ * filter that a stale build could skip. Pass the active team's declared format.
+ *
+ * A null `teamSize` yields an empty list rather than every fixture — the user
+ * has no team, or a captain has not declared a format yet, and neither is a
+ * licence to show fixtures they cannot legally accept. It is also part of the
+ * query key, so switching teams re-fetches instead of re-serving the other
+ * format's rows (same reason the radius is in the key).
  */
 export function useNearbyOpenChallenges(
   coords?: { lat: number; lng: number } | null,
   sport?: string | null,
   radiusM?: number,
+  teamSize?: number | null,
 ) {
   return useQuery({
-    // Same reason as useNearbyMatches: the radius must be in the key or a
-    // widened search re-serves the old distance's rows.
     queryKey: [
       'challenges',
       'nearby',
@@ -245,6 +254,7 @@
       coords?.lng ?? 'none',
       sport ?? 'all',
       radiusM ?? 'default',
+      teamSize ?? 'no-format',
     ] as const,
     queryFn: () =>
       challengeRepository.listNearbyOpenChallenges({
@@ -254,7 +264,11 @@
         // Undefined keeps the repository's own 50 km default for the callers
         // that never had a control (Home, the radar).
         radiusM,
+        teamSize: teamSize ?? null,
       }),
+    // Nothing to poll for when no format is set; the answer cannot change until
+    // the captain declares one, which invalidates this key anyway.
+    enabled: teamSize != null,
     refetchInterval: 10000,
   });
 }
```

### src/shared/types/database.types.ts
```diff
--- a/src/shared/types/database.types.ts
+++ b/src/shared/types/database.types.ts
@@ -485,8 +485,13 @@
           logo_url: string | null;
           home_ground: string | null;
           /**
-           * Squad size the captain is recruiting to. NULL = not recruiting, and
-           * the team is then absent from list_teams_needing_players.
+           * The team's FORMAT in players per side: 4 means "we are a 4 v 4
+           * side". Re-purposed from "recruiting target" in
+           * 20260903090000_squad_only_matchmaking.sql.
+           *
+           * NULL is not a wildcard — it means the team has not declared a
+           * format and is out of matchmaking in both directions: the radar
+           * cannot rank it and `list_open_challenges_nearby` shows it nothing.
            */
           target_size: number | null;
           created_at: string;
@@ -830,63 +835,26 @@
       // in one round trip. Replaces a get_team_overview + get_team_stats pair
       // per rendered card.
       /**
-       * Find Players. 20260901111030_team_join_requests.sql.
-       * A captain sets target_size to start recruiting (null = not recruiting,
-       * which is why the team then vanishes from list_teams_needing_players).
+       * The team's declared FORMAT, in players per side.
+       *
+       * The RPC keeps its old name because the column does
+       * (`teams.target_size`), but its meaning changed in
+       * 20260903090000_squad_only_matchmaking.sql: it was "recruit up to N
+       * players" and is now "we are an N v N side". It is the value strict
+       * format-to-format matchmaking compares on both sides of every fixture,
+       * and null means the team is not in matchmaking at all.
+       *
+       * `list_teams_needing_players`, `request_to_join_team`,
+       * `list_team_join_requests` and `respond_to_join_request` were dropped in
+       * the same migration with the solo-player Find Players flow.
        */
       set_team_target_size: {
         Args: { in_team_id: string; in_size: number | null };
         Returns: Database['public']['Tables']['teams']['Row'];
       };
-      list_teams_needing_players: {
-        Args: {
-          in_lat?: number | null;
-          in_lng?: number | null;
-          in_radius_m?: number;
-          in_sport?: string | null;
-        };
-        Returns: {
-          team_id: string; name: string; sport: Sport; logo_url: string | null;
-          home_ground: string | null;
-          /**
-           * The area the squad plays in, taken from the captain's profile.
-           * `home_ground` is free text nothing in the app writes, so this is the
-           * value the card actually shows.
-           */
-          area_name: string | null;
-          player_count: number; target_size: number;
-          slots_left: number; captain_name: string; distance_m: number;
-          my_request_status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | null;
-          /**
-           * The squad's next fixture, so a stranger has something to judge the
-           * team on. Null when they have nothing on the books.
-           * 'match' = a real game; 'challenge' = still looking for an opponent.
-           */
-          next_game_at: string | null;
-          next_game_where: string | null;
-          next_game_kind: 'match' | 'challenge' | null;
-        }[];
-      };
-      request_to_join_team: {
-        Args: { in_team_id: string; in_message?: string | null };
-        Returns: Database['public']['Tables']['team_join_requests']['Row'];
-      };
-      list_team_join_requests: {
-        Args: { in_team_id: string };
-        Returns: {
-          request_id: string; user_id: string; full_name: string;
-          avatar_url: string | null; area_name: string | null;
-          playing_role: string | null; matches_played: number;
-          message: string | null; status: string; created_at: string;
-        }[];
-      };
-      respond_to_join_request: {
-        Args: { in_request_id: string; in_accept: boolean };
-        Returns: Database['public']['Tables']['team_join_requests']['Row'];
-      };
       get_my_teams_overview: {
         Args: Record<string, never>;
-        Returns: { id: string; name: string; sport: Sport; invite_code: string; logo_url: string | null; home_ground: string | null; player_count: number; my_role: TeamRole; i_am_owner: boolean; matches_played: number; wins: number; losses: number; ties: number; win_rate: number }[];
+        Returns: { id: string; name: string; sport: Sport; invite_code: string; logo_url: string | null; home_ground: string | null; player_count: number; my_role: TeamRole; i_am_owner: boolean; matches_played: number; wins: number; losses: number; ties: number; win_rate: number; /** The team's declared format in players per side. Null = not in matchmaking. Added 20260903090000. */ target_size: number | null }[];
       };
       get_team_stats: {
         Args: { in_team_id: string };
@@ -1345,6 +1313,12 @@
           in_lng?: number | null;
           in_radius_m?: number;
           in_sport?: string | null;
+          /**
+           * The caller's team format in players per side. NOT optional in
+           * practice: the function returns zero rows for a null, because a team
+           * that has not declared a format cannot legally accept any fixture.
+           */
+          in_team_size: number | null;
         };
         Returns: {
           challenge_id: string;
```

### CLAUDE.md
```diff
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -123,6 +123,45 @@
   cosmetic and says so. Widening the search withdraws the challenge first,
   because `post_open_challenge` refuses a second live one per team.
 
+**Squad vs squad only, and format is a hard filter (3 Sep 2026).** Two rules
+that are really one rule, in `20260903090000_squad_only_matchmaking.sql`.
+
+*No individual enters team matchmaking.* The Find Players board — a solo player
+browsing squads and asking to join one — is gone: `app/teams/find-players.tsx`,
+`app/match/create/player-searching.tsx` and `app/teams/[id]/requests.tsx` are
+deleted, `list_teams_needing_players`, `request_to_join_team`,
+`list_team_join_requests` and `respond_to_join_request` are dropped, and
+`recruitRepository` is down to one method. `public.team_join_requests` is kept
+but inert — no RPC, no grants — so historical rows survive; drop it separately
+when the data is no longer wanted. A squad grows by invite code.
+
+*A team plays one format, and only that format.* `teams.target_size` was
+"recruiting to N players" and is now the team's DECLARED FORMAT in players per
+side — a 6 means "we are a 6 v 6 side". A fixture's format is `total_slots / 2`
+(`public.challenge_format`), a team's is `target_size`, and
+`public.team_format_matches` is the single comparison every path uses. A NULL
+format is NOT a wildcard: the team is out of matchmaking in both directions,
+which is why the discovery screens distinguish "no team", "no format" and "no
+opponents at this format" instead of showing one empty list.
+
+Enforced in seven places so no path can skip it: `rank_challenge_candidates`
+(the radar ranks same-format teams only), `list_open_challenges_nearby` (which
+gained a required `in_team_size` and returns nothing for a null),
+`apply_to_open_challenge`, `accept_open_challenge` (both sides re-checked at
+acceptance), and the three triggers — insert and accept on `team_challenges`,
+insert/update on `challenge_candidates` — which is what covers `create_challenge`
+and `respond_to_challenge` without editing either. Tokens are
+`FORMAT_MISMATCH` and `OPPONENT_FORMAT_MISMATCH`, ordered before each other in
+`challengeRepository`'s table for the same substring reason as the squad tokens.
+
+The per-fixture override still exists and is honest: Step 3 defaults the size
+chips to the team's format, and choosing a different one calls
+`set_team_target_size` FIRST and posts second. Posting first simply fails — the
+insert trigger compares the fixture's format with the poster's — because a team
+judged by one format while posting another is the asymmetry the whole change
+exists to remove. `rank_challenge_candidates` also regained the two self-match
+exclusions that `20260820120000` dropped when it rewrote the function.
+
 `app/teams/offers.tsx` is both sides of an open challenge. With no params it is
 the **incoming** list (accept / decline). With `?challengeId=` it is the
 **poster's** view of who the fixture reached, fed by `get_challenge_candidates`
@@ -185,6 +224,10 @@
 approve & confirm · play & mark attended · "I'm available today" · static venue directory
 ("call to confirm") · attendance flag · report & block.
 
+Note "fill missing players" means filling an OPEN match's sheet with individual
+players. It never meant filling a team fixture: since 3 Sep 2026 no individual
+can queue for, search for or join a Team vs Team lobby at all.
+
 **Open matches (18 Aug 2026).** `matches.match_type` is `'team_vs_team'` or
 `'open'`; every row that predates the column is `'team_vs_team'`, which is what
 makes the split safe. An open match has `team_a_id`, `team_b_id` and
```
