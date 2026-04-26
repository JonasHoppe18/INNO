'use client';

export default function DashboardGreeting({ firstName }) {
  const hour = new Date().getHours();

  let greeting;
  if (hour < 12) {
    greeting = 'Good morning';
  } else if (hour < 18) {
    greeting = 'Good afternoon';
  } else {
    greeting = 'Good evening';
  }

  return (
    <div className="pb-1">
      <h1 className="text-xl font-semibold">
        {greeting}, {firstName} 👋
      </h1>
      <p className="text-sm text-muted-foreground">
        Here&apos;s what&apos;s happening with your support today.
      </p>
    </div>
  );
}
