/**
 * DashboardHeader user-menu accessibility regression.
 *
 * The avatar trigger must expose aria-haspopup/aria-expanded, the dropdown must
 * be a role="menu" with menuitems, and Escape must close it (focus returns to
 * the trigger). Guards the global header menu wired in the a11y wave.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardHeader } from '../../components/dashboard/DashboardHeader';

function renderHeader() {
  return render(
    <DashboardHeader
      user={{ id: 'u1', email: 'test@example.com', role: 'PATIENT' }}
      onLogout={vi.fn()}
      onOpenMobileSidebar={vi.fn()}
      onOpenAccountSettings={vi.fn()}
    />
  );
}

describe('DashboardHeader user menu accessibility', () => {
  it('toggles aria-expanded, exposes a role=menu with menuitems, and closes on Escape', () => {
    const { container } = renderHeader();

    const trigger = container.querySelector('[aria-haspopup="menu"]') as HTMLElement;
    expect(trigger).toBeTruthy();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThanOrEqual(2);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
