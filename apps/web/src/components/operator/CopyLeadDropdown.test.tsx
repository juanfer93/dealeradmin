import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CopyLeadDropdown } from './CopyLeadDropdown';

describe('CopyLeadDropdown', () => {
  it('offers other dealers and requests confirmation for the selected target', () => {
    const onRequestCopy = vi.fn();
    render(
      <CopyLeadDropdown
        leadId="lead-1"
        currentDealerId="dealer-source"
        dealers={[{ id: 'dealer-source', name: 'Dealer Source' }, { id: 'dealer-target', name: 'Dealer Target' }]}
        label="Copy lead to another dealer"
        chooseLabel="Copy to…"
        onRequestCopy={onRequestCopy}
      />,
    );

    const select = screen.getByRole('combobox', { name: 'Copy lead to another dealer' });
    expect(screen.queryByRole('option', { name: 'Dealer Source' })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'dealer-target' } });

    expect(onRequestCopy).toHaveBeenCalledWith('dealer-target');
    expect(select).toHaveValue('');
  });
});
