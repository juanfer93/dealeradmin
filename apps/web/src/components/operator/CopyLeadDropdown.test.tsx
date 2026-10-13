import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CopyLeadDropdown, formatReengagedContact } from './CopyLeadDropdown';

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

  it('formats the exact contact text for the reengagement queue', () => {
    expect(formatReengagedContact('+13212343212')).toBe('*Contacto +13212343212 volvio a escribir*');
    expect(formatReengagedContact('+13212343212', 3)).toBe('*Contacto +13212343212 escribe de forma insistente*');
  });

  it('exposes a dedicated copy-contact action for reengagement rows', () => {
    const onCopyContact = vi.fn();
    render(
      <CopyLeadDropdown
        leadId="lead-1"
        currentDealerId="dealer-source"
        dealers={[]}
        label="Copy lead to another dealer"
        chooseLabel="Copy to…"
        reengagementPhone="+13212343212"
        copyContactLabel="Copiar contacto"
        onCopyContact={onCopyContact}
        onRequestCopy={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copiar contacto' }));
    expect(onCopyContact).toHaveBeenCalledOnce();
  });
});
