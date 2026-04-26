'use client';

import Link from 'next/link';

export default function DashboardGreeting({ firstName, conversationCount = 0, attentionCount = 0 }) {
  const hour = new Date().getHours();

  let greeting;
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 18) greeting = 'Good afternoon';
  else greeting = 'Good evening';

  return (
    <div className="pb-1">
      <h1 className="text-2xl font-semibold tracking-tight">
        {greeting}, <span className="text-indigo-600 dark:text-indigo-400">{firstName}</span> 👋
      </h1>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Here's what's happening with your support today.
      </p>
      {attentionCount > 0 && (
        <Link
          href="/inbox"
          className="mt-1 inline-block text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline underline-offset-2"
        >
          {attentionCount} ticket{attentionCount !== 1 ? 's' : ''} need your attention.
        </Link>
      )}
    </div>
  );
}
