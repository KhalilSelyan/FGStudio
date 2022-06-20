// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { set } from "lodash";

import { toNanoSec } from "@foxglove/rostime";
import { SettingsTreeAction } from "@foxglove/studio-base/components/SettingsTreeEditor/types";

import { Renderer } from "../Renderer";
import { RawMessage, RawMessageEvent, SceneExtension } from "../SceneExtension";
import { SettingsTreeEntry, SettingsTreeNodeWithActionHandler } from "../SettingsManager";
import {
  normalizeColorRGBA,
  normalizeColorRGBAs,
  normalizeHeader,
  normalizePose,
  normalizeTime,
  normalizeVector3,
  normalizeVector3s,
} from "../normalizeMessages";
import { Marker, MarkerArray, MARKER_ARRAY_DATATYPES, MARKER_DATATYPES } from "../ros";
import { BaseSettings } from "../settings";
import { makePose } from "../transforms";
import { LayerSettingsMarkerNamespace, TopicMarkers } from "./TopicMarkers";

export type LayerSettingsMarker = BaseSettings & {
  namespaces: Record<string, LayerSettingsMarkerNamespace>;
};

const DEFAULT_SETTINGS: LayerSettingsMarker = {
  visible: true,
  namespaces: {},
};

export class Markers extends SceneExtension<TopicMarkers> {
  constructor(renderer: Renderer) {
    super("foxglove.Markers", renderer);

    renderer.addDatatypeSubscriptions(MARKER_ARRAY_DATATYPES, this.handleMarkerArray);
    renderer.addDatatypeSubscriptions(MARKER_DATATYPES, this.handleMarker);
  }

  override settingsNodes(): SettingsTreeEntry[] {
    const configTopics = this.renderer.config.topics;
    const entries: SettingsTreeEntry[] = [];
    for (const topic of this.renderer.topics ?? []) {
      if (MARKER_ARRAY_DATATYPES.has(topic.datatype) || MARKER_DATATYPES.has(topic.datatype)) {
        const config = (configTopics[topic.name] ?? {}) as Partial<LayerSettingsMarker>;

        const node: SettingsTreeNodeWithActionHandler = {
          label: topic.name,
          icon: "Shapes",
          visible: config.visible ?? true,
          handler: this.handleSettingsActionTopic,
        };

        // Create a list of all the namespaces for this topic
        const topicMarkers = this.renderables.get(topic.name);
        const namespaces = Array.from(topicMarkers?.namespaces.values() ?? [])
          .filter((ns) => ns.namespace !== "")
          .sort((a, b) => a.namespace.localeCompare(b.namespace));
        if (namespaces.length > 0) {
          node.children = {};
          for (const ns of namespaces) {
            const child: SettingsTreeNodeWithActionHandler = {
              label: ns.namespace,
              icon: "Shapes",
              visible: ns.settings.visible,
              defaultExpansionState: namespaces.length > 1 ? "collapsed" : "expanded",
              handler: this.handleSettingsActionNamespace,
            };
            node.children[`ns:${ns.namespace}`] = child;
          }
        }

        entries.push({ path: ["topics", topic.name], node });
      }
    }
    return entries;
  }

  override startFrame(currentTime: bigint, renderFrameId: string, fixedFrameId: string): void {
    // Don't use SceneExtension#startFrame() because our renderables represent one topic each with
    // many markers. Instead, call startFrame on each renderable
    for (const renderable of this.renderables.values()) {
      renderable.startFrame(currentTime, renderFrameId, fixedFrameId);
    }
  }

  handleSettingsActionTopic = (action: SettingsTreeAction): void => {
    const path = action.payload.path;
    if (action.action !== "update" || path.length !== 3) {
      return;
    }

    this.saveSetting(path, action.payload.value);

    // Update the TopicMarkers settings
    const topicName = path[1]!;
    const renderable = this.renderables.get(topicName);
    if (renderable) {
      const settings = this.renderer.config.topics[topicName] as
        | Partial<LayerSettingsMarker>
        | undefined;
      renderable.userData.settings = { ...renderable.userData.settings, ...settings };
    }
  };

  handleSettingsActionNamespace = (action: SettingsTreeAction): void => {
    const path = action.payload.path;
    if (action.action !== "update" || path.length !== 4) {
      return;
    }

    const topicName = path[1]!;
    const namespaceKey = path[2]!;
    const fieldName = path[3]!;
    const namespace = namespaceKey.slice(3); // remove `ns:` prefix

    this.renderer.updateConfig((draft) => {
      // We build the settings tree with paths of the form
      //   ["topics", <topic>, "ns:"<namespace>, "visible"]
      // but the config is stored with paths of the form
      //   ["topics", <topic>, "namespaces", <namespace>, "visible"]
      const actualPath = ["topics", topicName, "namespaces", namespace, fieldName];
      set(draft, actualPath, action.payload.value);
    });

    // Update the MarkersNamespace settings
    const renderable = this.renderables.get(topicName);
    if (renderable) {
      const settings = this.renderer.config.topics[topicName] as
        | Partial<LayerSettingsMarker>
        | undefined;
      const ns = renderable.namespaces.get(namespace);
      if (ns) {
        const nsSettings = settings?.namespaces?.[namespace] as
          | Partial<LayerSettingsMarkerNamespace>
          | undefined;
        ns.settings = { ...ns.settings, ...nsSettings };
      }
    }

    // Update the settings sidebar
    this.updateSettingsTree();
  };

  handleMarkerArray = (messageEvent: RawMessageEvent<MarkerArray>): void => {
    const topic = messageEvent.topic;
    const markerArray = messageEvent.message;
    const receiveTime = toNanoSec(messageEvent.receiveTime);

    for (const markerMsg of markerArray.markers ?? []) {
      const marker = normalizeMarker(markerMsg);
      this.addMarker(topic, marker, receiveTime);
    }
  };

  handleMarker = (messageEvent: RawMessageEvent<Marker>): void => {
    const topic = messageEvent.topic;
    const marker = normalizeMarker(messageEvent.message);
    const receiveTime = toNanoSec(messageEvent.receiveTime);

    this.addMarker(topic, marker, receiveTime);
  };

  addMarker(topic: string, marker: Marker, receiveTime: bigint): void {
    let topicMarkers = this.renderables.get(topic);
    if (!topicMarkers) {
      const userSettings = this.renderer.config.topics[topic] as
        | Partial<LayerSettingsMarker>
        | undefined;

      topicMarkers = new TopicMarkers(topic, this.renderer, {
        receiveTime,
        messageTime: toNanoSec(marker.header.stamp),
        frameId: marker.header.frame_id,
        pose: makePose(),
        settingsPath: ["topics", topic],
        topic,
        settings: { ...DEFAULT_SETTINGS, ...userSettings },
      });
      this.renderables.set(topic, topicMarkers);
      this.add(topicMarkers);
    }

    const prevNsCount = topicMarkers.namespaces.size;
    topicMarkers.addMarkerMessage(marker, receiveTime);

    // If the topic has a new namespace, rebuild the settings node for this topic
    if (prevNsCount !== topicMarkers.namespaces.size) {
      this.updateSettingsTree();
    }
  }
}

function normalizeMarker(marker: RawMessage<Marker>): Marker {
  return {
    header: normalizeHeader(marker.header),
    ns: marker.ns ?? "",
    id: marker.id ?? 0,
    type: marker.type ?? 0,
    action: marker.action ?? 0,
    pose: normalizePose(marker.pose),
    scale: normalizeVector3(marker.scale),
    color: normalizeColorRGBA(marker.color),
    lifetime: normalizeTime(marker.lifetime),
    frame_locked: marker.frame_locked ?? false,
    points: normalizeVector3s(marker.points),
    colors: normalizeColorRGBAs(marker.colors),
    text: marker.text ?? "",
    mesh_resource: marker.mesh_resource ?? "",
    mesh_use_embedded_materials: marker.mesh_use_embedded_materials ?? false,
  };
}
