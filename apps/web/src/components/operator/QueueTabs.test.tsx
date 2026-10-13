import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueueTabs } from './QueueTabs';

const labels = { pending: 'Pendientes', wroteAgain: 'Volvieron a escribir', sent: 'Enviados', ariaLabel: 'Filtro de estado' };

describe('QueueTabs', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('marks the reengagement tab with the alert color while work is pending', () => {
    render(<QueueTabs status="pending" wroteAgainCount={2} labels={labels} onChange={vi.fn()} />);
    const tab = screen.getByRole('tab', { name: /Volvieron a escribir/ });
    expect(tab.className).toContain('bg-[#FEF2F2]');
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('restores the neutral style when no reengagement is pending', () => {
    render(<QueueTabs status="pending" wroteAgainCount={0} labels={labels} onChange={vi.fn()} />);
    const tab = screen.getByRole('tab', { name: 'Volvieron a escribir' });
    expect(tab.className).not.toContain('bg-[#FEF2F2]');
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('changes queues through the existing tab callback', () => {
    const onChange = vi.fn();
    render(<QueueTabs status="pending" wroteAgainCount={0} labels={labels} onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Volvieron a escribir' }));
    expect(onChange).toHaveBeenCalledWith('wrote_again');
  });
});
