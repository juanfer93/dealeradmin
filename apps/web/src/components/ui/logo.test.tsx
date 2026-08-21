import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Logo } from './logo';

describe('Día 4 Unit Tests - UI Components', () => {
  it('debería renderizar el logo SVG de dealerADMIN con sus dimensiones y elementos geométricos correctos', () => {
    const { container } = render(<Logo size={32} />);
    const svgElement = container.querySelector('svg');

    expect(svgElement).toBeInTheDocument();
    expect(svgElement).toHaveAttribute('width', '32');
    expect(svgElement).toHaveAttribute('height', '32');

    const rect = container.querySelector('rect');
    const paths = container.querySelectorAll('path');
    const circle = container.querySelector('circle');

    expect(rect).toBeInTheDocument();
    expect(rect).toHaveAttribute('rx', '22');
    expect(paths).toHaveLength(2);
    expect(circle).toBeInTheDocument();
  });
});
