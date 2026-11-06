import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { foodCategory, transportCategory } from '../../../test/cu01Cu02TestUtils';
import { EditTransactionModal } from './EditTransactionModal';

function renderEditor(overrides: Partial<Parameters<typeof EditTransactionModal>[0]> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<EditTransactionModal amount="15.00" concept="Almuerzo" categoryId={foodCategory.id} categories={[foodCategory, transportCategory]} onSave={onSave} onClose={onClose} {...overrides} />);
  return { onSave, onClose, user: userEvent.setup() };
}

describe('CU02 — edición de la vista previa', () => {
  it.each(['', '0', '0.00', '-1', 'abc', '1.001', '100000000', '1e3', '15,50'])('C02-EDIT-01: rechaza el monto %j sin guardar', async (amount) => {
    const { user, onSave } = renderEditor();
    fireEvent.change(screen.getByLabelText(/^Monto/i), { target: { value: amount } });
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ingresa un monto válido con hasta dos decimales.');
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Editar transacción' })).toBeInTheDocument();
  });

  it.each(['0.01', '1', '15.5', '99999999.99'])('C02-EDIT-02: acepta el monto válido %s', async (amount) => {
    const { user, onSave } = renderEditor();
    fireEvent.change(screen.getByLabelText(/^Monto/i), { target: { value: amount } });
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toEqual({ amount, concept: 'Almuerzo', category_id: foodCategory.id });
  });

  it.each([
    { name: 'vacío', concept: '' },
    { name: 'solo espacios', concept: '   ' },
    { name: 'mayor de 200 caracteres', concept: 'x'.repeat(201) },
  ])('C02-EDIT-03: rechaza el concepto $name', async ({ concept }) => {
    const { user, onSave } = renderEditor();
    // El cambio programático también comprueba la validación más allá del maxLength del navegador.
    fireEvent.change(screen.getByLabelText(/^Concepto/i), { target: { value: concept } });
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(concept.length > 200 ? 'no puede superar 200 caracteres' : 'Ingresa un concepto');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('C02-EDIT-04: permite 200 caracteres y limita la escritura posterior', async () => {
    const { user, onSave } = renderEditor({ concept: 'x'.repeat(200) });
    const input = screen.getByLabelText(/^Concepto/i);
    expect(input).toHaveAttribute('maxLength', '200');
    await user.type(input, 'y');
    expect(input).toHaveValue('x'.repeat(200));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ concept: 'x'.repeat(200) });
  });

  it('C02-EDIT-05: exige seleccionar una categoría', async () => {
    const { user, onSave } = renderEditor({ categoryId: '' });
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Selecciona una categoría.');
    expect(onSave).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Transporte' }));
    expect(screen.getByRole('button', { name: 'Transporte' })).toHaveAttribute('aria-pressed', 'true');
    const categories = screen.getByRole('group', { name: 'Elige una categoría' });
    expect(within(categories).getByRole('button', { pressed: false })).toHaveTextContent('Alimentación');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ category_id: transportCategory.id });
  });

  it('C02-EDIT-06: limpia espacios en los campos y envía la selección actual', async () => {
    const { user, onSave } = renderEditor();
    fireEvent.change(screen.getByLabelText(/^Monto/i), { target: { value: ' 15.50 ' } });
    fireEvent.change(screen.getByLabelText(/^Concepto/i), { target: { value: '  Viaje en taxi  ' } });
    await user.click(screen.getByRole('button', { name: 'Transporte' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(onSave.mock.calls[0]?.[0]).toEqual({ amount: '15.50', concept: 'Viaje en taxi', category_id: transportCategory.id });
  });

  it('C02-EDIT-07: cerrar descarta los valores editados sin invocar onSave', async () => {
    const { user, onSave, onClose } = renderEditor();
    fireEvent.change(screen.getByLabelText(/^Monto/i), { target: { value: '99.00' } });
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('C02-EDIT-08: solo el clic en el fondo cierra el modal', () => {
    const { onSave, onClose } = renderEditor();
    const dialog = screen.getByRole('dialog', { name: 'Editar transacción' });
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('C02-EDIT-09: durante una operación bloquea los campos, las acciones y el cierre por fondo', async () => {
    const { user, onSave, onClose } = renderEditor({ busy: true });
    expect(screen.getByLabelText(/^Monto/i)).toBeDisabled();
    expect(screen.getByLabelText(/^Concepto/i)).toBeDisabled();
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
