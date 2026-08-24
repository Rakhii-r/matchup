/**
 * The Create Match wizard is a stack of real routes, not a single screen with
 * an index into a step array. That is what makes hardware back move one step
 * back instead of abandoning the flow, and what makes each step deep-linkable.
 *
 * Headers are off: every step draws its own, with the back affordance and the
 * "Step N of 3" progress indicator, from `WizardScreen`.
 *
 * Three steps: `index` (game + match type) → `area` → `details`. The old
 * `venue` step was replaced with area/radius discovery.
 */
import { Stack } from 'expo-router';

export default function CreateMatchWizardLayout(): React.ReactNode {
  return <Stack screenOptions={{ headerShown: false }} />;
}
