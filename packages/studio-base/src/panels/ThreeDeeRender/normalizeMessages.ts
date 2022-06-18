// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Time } from "@foxglove/rostime";

import type { RawMessage } from "./SceneExtension";
import type {
  ColorRGBA,
  Header,
  Matrix6,
  Quaternion,
  TFMessage,
  Transform,
  TransformStamped,
  Vector3,
} from "./ros";
import type { Pose } from "./transforms/geometry";

export function normalizeTime(time: Partial<Time> | undefined): Time {
  if (!time) {
    return { sec: 0, nsec: 0 };
  }
  return { sec: time.sec ?? 0, nsec: time.nsec ?? 0 };
}

export function normalizeByteArray(byteArray: unknown): Uint8Array {
  if (byteArray == undefined) {
    return new Uint8Array(0);
  } else if (byteArray instanceof Uint8Array) {
    return byteArray;
  } else if (Array.isArray(byteArray) || byteArray instanceof ArrayBuffer) {
    return new Uint8Array(byteArray);
  } else {
    return new Uint8Array(0);
  }
}

export function normalizeInt8Array(int8Array: unknown): Int8Array {
  if (int8Array == undefined) {
    return new Int8Array(0);
  } else if (int8Array instanceof Int8Array) {
    return int8Array;
  } else if (Array.isArray(int8Array) || int8Array instanceof ArrayBuffer) {
    return new Int8Array(int8Array);
  } else {
    return new Int8Array(0);
  }
}

export function normalizeVector3(vector: Partial<Vector3> | undefined): Vector3 {
  if (!vector) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: vector.x ?? 0, y: vector.y ?? 0, z: vector.z ?? 0 };
}

export function normalizeVector3s(vectors: Partial<Vector3>[] | undefined): Vector3[] {
  if (!vectors) {
    return [];
  }
  return vectors.map(normalizeVector3);
}

export function normalizeMatrix6(mat: number[] | undefined): Matrix6 {
  if (!mat || mat.length !== 36 || typeof mat[0] !== "number") {
    // prettier-ignore
    return [
      1, 0, 0, 0, 0, 0,
      0, 1, 0, 0, 0, 0,
      0, 0, 1, 0, 0, 0,
      0, 0, 0, 1, 0, 0,
      0, 0, 0, 0, 1, 0,
      0, 0, 0, 0, 0, 1
    ];
  }
  return mat as Matrix6;
}

export function normalizeQuaternion(quat: Partial<Quaternion> | undefined): Quaternion {
  if (!quat) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  return { x: quat.x ?? 0, y: quat.y ?? 0, z: quat.z ?? 0, w: quat.w ?? 0 };
}

export function normalizeColorRGBA(color: Partial<ColorRGBA> | undefined): ColorRGBA {
  if (!color) {
    return { r: 0, g: 0, b: 0, a: 1 };
  }
  // alpha defaults to 1 if unspecified
  return { r: color.r ?? 0, g: color.g ?? 0, b: color.b ?? 0, a: color.a ?? 1 };
}

export function normalizeColorRGBAs(colors: Partial<ColorRGBA>[] | undefined): ColorRGBA[] {
  if (!colors) {
    return [];
  }
  return colors.map(normalizeColorRGBA);
}

export function normalizePose(pose: RawMessage<Pose> | undefined): Pose {
  return {
    position: normalizeVector3(pose?.position),
    orientation: normalizeQuaternion(pose?.orientation),
  };
}

export function normalizeHeader(header: RawMessage<Header> | undefined): Header {
  return {
    frame_id: header?.frame_id ?? "",
    stamp: normalizeTime(header?.stamp),
    seq: header?.seq,
  };
}

export function normalizeTransform(transform: RawMessage<Transform> | undefined): Transform {
  return {
    translation: normalizeVector3(transform?.translation),
    rotation: normalizeQuaternion(transform?.rotation),
  };
}

export function normalizeTransformStamped(
  transform: RawMessage<TransformStamped> | undefined,
): TransformStamped {
  return {
    header: normalizeHeader(transform?.header),
    child_frame_id: transform?.child_frame_id ?? "",
    transform: normalizeTransform(transform?.transform),
  };
}

export function normalizeTFMessage(tfMessage: RawMessage<TFMessage> | undefined): TFMessage {
  return {
    transforms: (tfMessage?.transforms ?? []).map(normalizeTransformStamped),
  };
}
