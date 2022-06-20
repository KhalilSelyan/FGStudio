// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export type SelectEntry = { label: string; value: string };

export type BaseSettings = {
  visible: boolean;
  frameLocked?: boolean;
};

export type CustomLayerSettings = BaseSettings & {
  instanceId: string;
  layerId: string;
  label: string;
};

export const PRECISION_DISTANCE = 3; // [1mm]
export const PRECISION_DEGREES = 1;
