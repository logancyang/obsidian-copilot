export interface PairedDeviceView {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
  connected: boolean;
}

export interface PairingView {
  link: string;
  expiresAt: number;
}

export interface RemoteHostViewState {
  plus: boolean;
  tailscaleAddress: string | null;
  listening: boolean;
  pairing: PairingView | null;
  devices: readonly PairedDeviceView[];
  error: string | null;
}
