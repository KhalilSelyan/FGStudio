// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { v4 as uuidv4 } from "uuid";

import { CameraState } from "@foxglove/regl-worldview";
import { Topic } from "@foxglove/studio";
import {
  SettingsTreeChildren,
  SettingsTreeNode,
  SettingsTreeRoots,
} from "@foxglove/studio-base/components/SettingsTreeEditor/types";

import { NodeError } from "./LayerErrors";

export type SelectEntry = { label: string; value: string };

export type BaseSettings = {
  visible: boolean;
  frameLocked?: boolean;
};

export type LayerSettingsTransform = BaseSettings;

export type LayerSettingsMarkerNamespace = BaseSettings;

export type LayerSettingsMarker = BaseSettings & {
  namespaces: Record<string, LayerSettingsMarkerNamespace>;
};

export type LayerSettingsOccupancyGrid = BaseSettings & {
  frameLocked: boolean;
  minColor: string;
  maxColor: string;
  unknownColor: string;
  invalidColor: string;
};

export type LayerSettingsPointCloud2 = BaseSettings & {
  pointSize: number;
  pointShape: "circle" | "square";
  decayTime: number;
  colorMode: "flat" | "gradient" | "colormap" | "rgb" | "rgba";
  flatColor: string;
  colorField: string | undefined;
  gradient: [string, string];
  colorMap: "turbo" | "rainbow";
  rgbByteOrder: "rgba" | "bgra" | "abgr";
  minValue: number | undefined;
  maxValue: number | undefined;
};

export type LayerSettingsPolygon = BaseSettings & {
  lineWidth: number;
  color: string;
};

export type LayerSettingsPose = BaseSettings & {
  scale: [number, number, number];
  color: string;
  showCovariance: boolean;
  covarianceColor: string;
};

export type LayerSettingsCameraInfo = BaseSettings & {
  distance: number;
  width: number;
  color: string;
};

export type LayerSettingsImage = BaseSettings & {
  cameraInfoTopic: string | undefined;
  distance: number;
  color: string;
};

export type CustomLayerSettings = BaseSettings & {
  label: string;
  type: LayerType;
};

export type LayerSettingsGrid = CustomLayerSettings & {
  type: LayerType.Grid;
  frameId: string | undefined;
  size: number;
  divisions: number;
  lineWidth: number;
  color: string;
  position: [number, number, number];
  rotation: [number, number, number];
};

export type LayerSettings =
  | LayerSettingsMarker
  | LayerSettingsOccupancyGrid
  | LayerSettingsPointCloud2
  | LayerSettingsPose
  | LayerSettingsCameraInfo
  | LayerSettingsImage;

export enum LayerType {
  Transform,
  Marker,
  OccupancyGrid,
  PointCloud,
  Polygon,
  Pose,
  CameraInfo,
  Image,
  Grid,
}

export type ThreeDeeRenderConfig = {
  cameraState: CameraState;
  followTf: string | undefined;
  scene: {
    enableStats?: boolean;
    backgroundColor?: string;
  };
  transforms: Record<string, LayerSettingsTransform>;
  topics: Record<string, Record<string, unknown> | undefined>;
  layers: Record<string, CustomLayerSettings>;
};

export type SettingsNodeProvider = (
  topicConfig: Partial<LayerSettings>,
  topic: Topic,
) => SettingsTreeNode;

export const PRECISION_DISTANCE = 3; // [1mm]
export const PRECISION_DEGREES = 1;

// This is the unused topic parameter passed to the SettingsNodeProvider for
// LayerType.Transform, since transforms do not map 1:1 to topics, and custom
// layers which do not have a topic name or datatype
const EMPTY_TOPIC = { name: "", datatype: "" };

const PATH_LAYERS = ["layers"];

export type SettingsTreeOptions = {
  config: ThreeDeeRenderConfig;
  coordinateFrames: ReadonlyArray<SelectEntry>;
  layerErrors: NodeError;
  followTf: string | undefined;
  topics: ReadonlyArray<Topic>;
  topicsToLayerTypes: Map<string, LayerType>;
  settingsNodeProviders: Map<LayerType, SettingsNodeProvider>;
};

function buildLayerNode(
  layer: CustomLayerSettings,
  settingsNodeProvider: SettingsNodeProvider,
  coordinateFrames: ReadonlyArray<SelectEntry>,
): undefined | SettingsTreeNode {
  const node = settingsNodeProvider(layer, EMPTY_TOPIC);
  node.label ??= layer.label;
  node.visible ??= layer.visible;
  node.defaultExpansionState ??= "collapsed";

  // Populate coordinateFrames into options for the "frameId" field
  const frameIdField = node.fields?.["frameId"];
  if (frameIdField && frameIdField.input === "select") {
    frameIdField.options = [...frameIdField.options, ...coordinateFrames] as SelectEntry[];
  }

  return node;
}

export function buildSettingsTree(options: SettingsTreeOptions): SettingsTreeRoots {
  const { config, coordinateFrames, layerErrors, settingsNodeProviders } = options;

  // Build the settings tree for custom layers
  const layersChildren: SettingsTreeChildren = {};
  for (const [layerId, layer] of Object.entries(config.layers)) {
    const layerType = layer.type;
    const settingsNodeProvider = settingsNodeProviders.get(layerType);
    if (settingsNodeProvider == undefined) {
      continue;
    }
    const newNode = buildLayerNode(layer, settingsNodeProvider, coordinateFrames);
    if (newNode) {
      newNode.error = layerErrors.errorAtPath(["layers", layerId]);
      newNode.actions ??= [];
      if (
        newNode.actions.find((action) => action.type === "action" && action.id === "delete") ==
        undefined
      ) {
        newNode.actions.push({ type: "action", id: "delete", label: "Delete" });
      }
      layersChildren[layerId] = newNode;
    }
  }

  return {
    layers: {
      error: layerErrors.errorAtPath(PATH_LAYERS),
      label: "Custom Layers",
      children: layersChildren,
      defaultExpansionState: "expanded",
      actions: [{ type: "action", id: "add-grid " + uuidv4(), label: "Add Grid", icon: "Grid" }],
    },
  };
}
