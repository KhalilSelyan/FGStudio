// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { debounce, set } from "lodash";
import * as THREE from "three";
import { DeepPartial } from "ts-essentials";

import { MessageEvent } from "@foxglove/studio";

import { Path } from "./LayerErrors";
import { BaseUserData, Renderable } from "./Renderable";
import type { Renderer } from "./Renderer";
import type { SettingsTreeEntry } from "./SettingsManager";
import { missingTransformMessage, MISSING_TRANSFORM } from "./renderables/transforms";
import { updatePose } from "./updatePose";

export type RawMessage<T> = DeepPartial<T>;

export type RawMessageEvent<T> = MessageEvent<DeepPartial<T>>;

export class SceneExtension<
  TRenderable extends Renderable<BaseUserData> = Renderable<BaseUserData>,
> extends THREE.Object3D {
  readonly extensionId: string;
  readonly renderer: Renderer;
  readonly renderables = new Map<string, TRenderable>();

  private _settingsUpdateDebounced = debounce(
    () => this.renderer.settings.setNodesForKey(this.extensionId, this.settingsNodes()),
    100,
    { leading: true, trailing: true, maxWait: 100 },
  );

  constructor(extensionId: string, renderer: Renderer) {
    super();
    this.extensionId = this.name = extensionId;
    this.renderer = renderer;
    this.updateSettingsTree();
  }

  dispose(): void {
    for (const renderable of this.renderables.values()) {
      renderable.dispose();
    }
    this.children.length = 0;
    this.renderables.clear();
  }

  settingsNodes(): SettingsTreeEntry[] {
    return [];
  }

  updateSettingsTree(): void {
    this._settingsUpdateDebounced();
  }

  saveSetting(path: Path, value: unknown): void {
    // Update the configuration
    this.renderer.updateConfig((draft) => set(draft, path, value));

    // Update the settings sidebar
    this.updateSettingsTree();
  }

  setColorScheme(colorScheme: "dark" | "light", backgroundColor: THREE.Color | undefined): void {
    void colorScheme;
    void backgroundColor;
  }

  startFrame(currentTime: bigint, renderFrameId: string, fixedFrameId: string): void {
    for (const renderable of this.renderables.values()) {
      const path = renderable.userData.settingsPath;

      // Update the THREE.Object3D.visible flag from the user settings visible toggle. If this
      // renderable is not visible, clear any layer errors and skip its per-frame update logic
      renderable.visible = renderable.userData.settings.visible;
      if (!renderable.visible) {
        this.renderer.settings.errors.clearPath(path);
        continue;
      }

      // SceneExtension Renderables exist in a coordinate frame (`frameId`) at some position and
      // orientation (`pose`) at a point in time (`messageTime` if `frameLocked` is false, otherwise
      // `currentTime`). The scene is rendered from the point of view of another coordinate frame
      // (`renderFrameId`) that is part of a coordinate frame hierarchy with `fixedFrameId` at its
      // root (`renderFrameId` can be equal to `fixedFrameId`). The fixed is assumed to be the
      // static world coordinates that all other frames connect to.
      //
      // Before each visual frame is rendered, every Renderable is transformed from its own
      // coordinate frame (at its own `messageTime` when `frameLocked` is false) to the fixed frame
      // at `currentTime` and then to the render frame at `currentTime`. This transformation is
      // done using transform interpolation, so as new transform messages are received the results
      // of this interpolation can change from frame to frame
      const frameLocked = renderable.userData.settings.frameLocked ?? true;
      const srcTime = frameLocked ? currentTime : renderable.userData.messageTime;
      const frameId = renderable.userData.frameId;
      const updated = updatePose(
        renderable,
        this.renderer.transformTree,
        renderFrameId,
        fixedFrameId,
        frameId,
        currentTime,
        srcTime,
      );
      if (!updated) {
        const message = missingTransformMessage(renderFrameId, fixedFrameId, frameId);
        this.renderer.settings.errors.add(path, MISSING_TRANSFORM, message);
      } else {
        this.renderer.settings.errors.remove(path, MISSING_TRANSFORM);
      }
    }
  }

  // register message handlers for datatypes (creates subscription(s) upstream)

  // create settings nodes at arbitrary paths (or just under topics / layers?)

  // handle user input at or beneath the registered settings node paths

  // [x] startFrame, make it easy to update poses for all renderables

  // [x] how do we track all renderables? traverse children?

  // picking: enable/disable, provide custom shader(s), handle picking subcomponents
}
