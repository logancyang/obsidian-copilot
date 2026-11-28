import { EMPTY_PICKER_CATALOG, type PickerCatalog } from "@copilot/protocol/pickerCatalog";
import type { SliceOp } from "@copilot/protocol/session";

export interface HostState {
  pickerCatalog: PickerCatalog;
}

export const EMPTY_HOST_STATE: HostState = Object.freeze({ pickerCatalog: EMPTY_PICKER_CATALOG });

export type HostOp = SliceOp<HostState>;
