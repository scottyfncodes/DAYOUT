import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

beforeAll(() => {
  window.scrollTo = () => undefined;
  // /api/config is unreachable in tests → demo mode, like a deployment without keys.
  globalThis.fetch = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
});

describe('DayOut UI', () => {
  it('asks the question, finds a day, and only shows confirmed-open places', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('heading', { name: 'WHAT ARE WE DOING?' })).toBeInTheDocument();
    expect(screen.getByText(/Demo data/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Today' }));
    await user.click(screen.getByRole('button', { name: 'FIND MY DAY' }));
    await waitFor(() => expect(screen.getAllByText(/Open until/).length).toBeGreaterThan(0), { timeout: 10000 });
    expect(screen.queryByText(/Urban Putt/)).not.toBeInTheDocument(); // unknown hours
    expect(screen.queryByText(/Firefighters/)).not.toBeInTheDocument(); // temporarily closed
    expect(screen.getByText(/Nothing unverified made the list/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'ADD TO DAY' })[0]!);
    await user.click(screen.getByRole('button', { name: /BUILD MY DAY/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'YOUR DAY' })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Everything checks out.')).toBeInTheDocument(), { timeout: 10000 });
  }, 20000);
});
