import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlaceholderPage } from './PlaceholderPage';

describe('PlaceholderPage', () => {
  it('shows the page title and construction message', () => {
    render(<PlaceholderPage title="Inicio" />);
    expect(screen.getByRole('heading', { name: 'Inicio' })).toBeInTheDocument();
    expect(screen.getByText('En construcción')).toBeInTheDocument();
  });
});
