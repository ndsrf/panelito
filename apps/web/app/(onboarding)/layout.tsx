/**
 * Onboarding layout — minimal, focused single-purpose shell.
 *
 * D-04: The onboarding gate must be focused (no nav, no sidebar).
 * Uses CSS custom property --app-height for iOS/Android keyboard safety.
 */

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div
      style={{ height: 'var(--app-height)' }}
      className="flex items-center justify-center p-6 bg-background"
    >
      {children}
    </div>
  )
}
