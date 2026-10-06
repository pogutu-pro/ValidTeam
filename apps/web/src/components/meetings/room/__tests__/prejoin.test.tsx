import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Prejoin, type PrejoinInfo } from '../prejoin';

const previewMock = jest.fn();
jest.mock('@livekit/components-react', () => ({
  usePreviewTracks: (...a: unknown[]) => previewMock(...a),
}));

const info = (over: Partial<PrejoinInfo> = {}): PrejoinInfo => ({
  title: 'Product Planning',
  hostName: 'Paul',
  scheduledStartAt: '2026-10-07T07:00:00.000Z',
  status: 'live',
  isGuest: false,
  ...over,
});

describe('Prejoin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    previewMock.mockReturnValue(undefined);
  });

  it('shows meeting name, organizer, device state and a prominent join button', () => {
    render(
      <Prejoin
        info={info()}
        initialName="Ada"
        nameEditable={false}
        joining={false}
        error={null}
        onJoin={jest.fn()}
      />
    );
    expect(screen.getByRole('heading', { name: 'Product Planning' })).toBeInTheDocument();
    expect(screen.getByText(/organized by paul/i)).toBeInTheDocument();
    expect(screen.getByText(/in progress/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /microphone on/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: /camera on/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: /join meeting/i })).toBeEnabled();
    expect(screen.getByLabelText(/your name/i)).toHaveAttribute('readonly');
  });

  it('labels guests, lets them edit their name and blocks joining without one', async () => {
    const onJoin = jest.fn();
    render(
      <Prejoin
        info={info({ isGuest: true })}
        initialName=""
        nameEditable
        joining={false}
        error={null}
        onJoin={onJoin}
      />
    );
    expect(screen.getByText(/joining as a guest/i)).toBeInTheDocument();
    const join = screen.getByRole('button', { name: /join meeting/i });
    expect(join).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/your name/i), '  John Smith ');
    expect(join).toBeEnabled();
    await userEvent.click(join);
    expect(onJoin).toHaveBeenCalledWith({ name: 'John Smith', mic: true, camera: true });
  });

  it('passes the chosen microphone/camera state and shows state without relying on colour', async () => {
    const onJoin = jest.fn();
    render(
      <Prejoin
        info={info()}
        initialName="Ada"
        nameEditable={false}
        joining={false}
        error={null}
        onJoin={onJoin}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /microphone on/i }));
    await userEvent.click(screen.getByRole('button', { name: /camera on/i }));
    expect(screen.getByRole('button', { name: /microphone off/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.getByText(/microphone off · camera off/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /join meeting/i }));
    expect(onJoin).toHaveBeenCalledWith({ name: 'Ada', mic: false, camera: false });
  });

  it('surfaces join errors and disables the button while joining', () => {
    render(
      <Prejoin
        info={info()}
        initialName="Ada"
        nameEditable={false}
        joining
        error="The video service is not available right now."
        onJoin={jest.fn()}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/video service/i);
    expect(screen.getByRole('button', { name: /joining/i })).toBeDisabled();
  });

  it('falls back gracefully when the camera cannot be opened', () => {
    previewMock.mockImplementation((_opts: unknown, onError: () => void) => {
      queueMicrotask(onError);
      return undefined;
    });
    render(
      <Prejoin
        info={info()}
        initialName="Ada"
        nameEditable={false}
        joining={false}
        error={null}
        onJoin={jest.fn()}
      />
    );
    return screen.findByText(/camera is unavailable/i);
  });
});
