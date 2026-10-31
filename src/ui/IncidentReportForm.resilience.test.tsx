import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { IncidentReportForm } from './IncidentReportForm';
import type { IncidentLocation } from '../campusops/contracts';

async function form(resolve: (q: string, manual: string) => Promise<IncidentLocation>) {
  const submit = jest.fn();
  const view = await render(<IncidentReportForm submitting={false} onSubmit={submit} onDraftChange={() => undefined} geocodingClient={{ resolve }} />);
  await fireEvent.changeText(view.getByTestId('report-description'), 'Incidente ficticio');
  await fireEvent.changeText(view.getByTestId('report-location'), 'Edificio ficticio A');
  return { view, submit };
}
test('ui-manual: enviar no consulta al proveedor ni inventa coordenadas', async () => {
  const resolve = jest.fn();
  const { view, submit } = await form(resolve);
  await fireEvent.press(view.getByTestId('report-submit'));
  expect(resolve).not.toHaveBeenCalled();
  expect(submit).toHaveBeenCalledWith({ category: 'connectivity', description: 'Incidente ficticio', location: 'Edificio ficticio A' });
});
test.each(['manual', 'reject'] as const)('ui-fallback-%s: falla externa mantiene el formulario utilizable', async (kind) => {
  const { view, submit } = await form(async (_q, label) => { if (kind === 'reject') throw new Error('error privado'); return { source: 'manual', label }; });
  await fireEvent.press(view.getByTestId('location-search'));
  await waitFor(() => expect(view.getByTestId('location-notice')).toBeTruthy());
  await fireEvent.press(view.getByTestId('report-submit'));
  expect(submit.mock.calls[0]![0]).not.toHaveProperty('coordinates');
  expect(view.queryByText(/error privado/)).toBeNull();
});
test('ui-confirm: una sugerencia sólo aporta coordenadas al aceptarla', async () => {
  const { view, submit } = await form(async () => ({ source: 'provider', label: 'Resultado externo', latitude: 0, longitude: 0 }));
  await fireEvent.press(view.getByTestId('location-search'));
  expect(view.getByTestId('report-location').props.value).toBe('Edificio ficticio A');
  await fireEvent.press(view.getByTestId('location-accept'));
  await fireEvent.press(view.getByTestId('report-submit'));
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ location: 'Resultado externo', coordinates: { latitude: 0, longitude: 0 } }));
});
test('ui-revert: volver a manual elimina las coordenadas aceptadas', async () => {
  const { view, submit } = await form(async () => ({ source: 'provider', label: 'Resultado externo', latitude: 0, longitude: 0 }));
  await fireEvent.press(view.getByTestId('location-search'));
  await fireEvent.press(view.getByTestId('location-accept'));
  await fireEvent.press(view.getByTestId('location-manual'));
  await fireEvent.press(view.getByTestId('report-submit'));
  expect(submit.mock.calls[0]![0].location).toBe('Edificio ficticio A');
  expect(submit.mock.calls[0]![0]).not.toHaveProperty('coordinates');
});
test('ui-stale: editar descarta una búsqueda tardía y se puede enviar mientras busca', async () => {
  let finish!: (v: IncidentLocation) => void;
  const { view, submit } = await form(() => new Promise((done) => { finish = done; }));
  await fireEvent.press(view.getByTestId('location-search'));
  await fireEvent.changeText(view.getByTestId('report-location'), 'Otra zona ficticia');
  await act(async () => finish({ source: 'provider', label: 'Resultado viejo', latitude: 1, longitude: 2 }));
  expect(view.queryByTestId('location-suggestion')).toBeNull();
  await fireEvent.press(view.getByTestId('location-search'));
  await fireEvent.press(view.getByTestId('report-submit'));
  expect(submit.mock.calls[0]![0]).toEqual(expect.objectContaining({ location: 'Otra zona ficticia' }));
  await act(async () => finish({ source: 'provider', label: 'Resultado viejo', latitude: 1, longitude: 2 }));
  expect(view.queryByTestId('location-suggestion')).toBeNull();
});
