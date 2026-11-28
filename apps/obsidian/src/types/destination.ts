export type DestinationKind = "lock" | "cloud" | "local";

export interface Destination {
  kind: DestinationKind;
  label: string;
}
