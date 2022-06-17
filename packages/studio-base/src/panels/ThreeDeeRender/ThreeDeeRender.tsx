// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { isEqual, cloneDeep, merge } from "lodash";
import React, { useCallback, useLayoutEffect, useEffect, useState, useMemo, useRef } from "react";
import ReactDOM from "react-dom";
import { useResizeDetector } from "react-resize-detector";
import { DeepPartial } from "ts-essentials";
import { useDebouncedCallback } from "use-debounce";

import Logger from "@foxglove/log";
import {
  CameraListener,
  CameraState,
  CameraStore,
  DEFAULT_CAMERA_STATE,
} from "@foxglove/regl-worldview";
import { toNanoSec } from "@foxglove/rostime";
import { PanelExtensionContext, RenderState, Topic, MessageEvent } from "@foxglove/studio";
import {
  EXPERIMENTAL_PanelExtensionContextWithSettings,
  SettingsTreeAction,
  SettingsTreeRoots,
} from "@foxglove/studio-base/components/SettingsTreeEditor/types";
import useCleanup from "@foxglove/studio-base/hooks/useCleanup";

import { DebugGui } from "./DebugGui";
import { Renderer } from "./Renderer";
import { RendererContext, useRendererEvent } from "./RendererContext";
import { Stats } from "./Stats";
import { TF_DATATYPES, TRANSFORM_STAMPED_DATATYPES } from "./ros";
import { CustomLayerSettings, LayerSettings, LayerType, ThreeDeeRenderConfig } from "./settings";

const SHOW_DEBUG: true | false = false;

const log = Logger.getLogger(__filename);

function RendererOverlay(props: { enableStats: boolean }): JSX.Element {
  const [_, setSelectedRenderable] = useState<THREE.Object3D | undefined>(undefined);

  useRendererEvent("renderableSelected", (renderable) => setSelectedRenderable(renderable));

  const stats = props.enableStats ? (
    <div id="stats" style={{ position: "absolute", top: 0 }}>
      <Stats />
    </div>
  ) : undefined;

  const debug = SHOW_DEBUG ? (
    <div id="debug" style={{ position: "absolute", top: 60 }}>
      <DebugGui />
    </div>
  ) : undefined;

  return (
    <React.Fragment>
      {stats}
      {debug}
    </React.Fragment>
  );
}

export function ThreeDeeRender({ context }: { context: PanelExtensionContext }): JSX.Element {
  const { initialState, saveState } = context;

  // Load and save the persisted panel configuration
  const [config, setConfig] = useState<ThreeDeeRenderConfig>(() => {
    const partialConfig = initialState as DeepPartial<ThreeDeeRenderConfig> | undefined;
    const cameraState: CameraState = merge(
      cloneDeep(DEFAULT_CAMERA_STATE),
      partialConfig?.cameraState,
    );

    const layers: Record<string, CustomLayerSettings> = {};
    for (const [layerId, layer] of Object.entries(partialConfig?.layers ?? {})) {
      if (layer?.type != undefined) {
        layers[layerId] = layer as CustomLayerSettings;
      }
    }

    return {
      cameraState,
      followTf: partialConfig?.followTf,
      scene: partialConfig?.scene ?? {},
      transforms: {},
      topics: partialConfig?.topics ?? {},
      layers,
    };
  });
  const configRef = useRef(config);
  const { cameraState } = config;
  const backgroundColor = config.scene.backgroundColor;

  const [canvas, setCanvas] = useState<HTMLCanvasElement | ReactNull>(ReactNull);
  const [renderer, setRenderer] = useState<Renderer | ReactNull>(ReactNull);
  useEffect(() => {
    const curRenderer = canvas ? new Renderer(canvas, configRef.current) : ReactNull;
    setRenderer(curRenderer);

    if (curRenderer) {
      // Initialize all custom layers
      for (const [layerId, layerConfig] of Object.entries(configRef.current.layers)) {
        updateLayerSettings(curRenderer, layerId, layerConfig.type, layerConfig);
      }
    }
  }, [canvas]);

  const [colorScheme, setColorScheme] = useState<"dark" | "light" | undefined>();
  const [topics, setTopics] = useState<ReadonlyArray<Topic> | undefined>();
  const [messages, setMessages] = useState<ReadonlyArray<MessageEvent<unknown>> | undefined>();
  const [currentTime, setCurrentTime] = useState<bigint | undefined>();

  const renderRef = useRef({ needsRender: false });
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();

  const datatypeHandlers = useMemo(() => renderer?.datatypeHandlers ?? new Map(), [renderer]);

  // Config cameraState
  const setCameraState = useCallback((state: CameraState) => {
    setConfig((prevConfig) => ({ ...prevConfig, cameraState: state }));
  }, []);
  const [cameraStore] = useState(() => new CameraStore(setCameraState, cameraState));

  // Build a map from topic name to datatype
  const topicsToDatatypes = useMemo(() => {
    const map = new Map<string, string>();
    if (!topics) {
      return map;
    }
    for (const topic of topics) {
      map.set(topic.name, topic.datatype);
    }
    return map;
  }, [topics]);

  // Build a map from (renderable) topic name to LayerType enum
  // const topicsToLayerTypes = useMemo(() => buildTopicsToLayerTypes(topics), [topics]);

  // Handle user changes in the settings sidebar
  const actionHandler = useCallback(
    (action: SettingsTreeAction) => renderer?.settings.handleAction(action),
    [renderer],
  );

  // Handle internal changes to the settings sidebar
  // useRendererEvent(
  //   "settingsTreeChange",
  //   (update) => {
  //     setConfig((oldConfig) =>
  //       produce(oldConfig, (draft) => {
  //         const entry = get(renderer?.config ?? draft, update.path);
  //         set(draft, update.path, { ...entry });
  //       }),
  //     );
  //   },
  //   renderer,
  // );

  // useRendererEvent("configUpdated", (newConfig) => setConfig(newConfig), renderer);

  // Maintain a list of coordinate frames for the settings sidebar
  // const [coordinateFrames, setCoordinateFrames] = useState<SelectEntry[]>(
  //   coordinateFrameList(renderer),
  // );

  // Select a default coordinate frame in case the user hasn't selected one
  // const [defaultFrame, setDefaultFrame] = useState<string | undefined>(undefined);
  // const updateCoordinateFrames = useCallback(
  //   (curRenderer: Renderer) => {
  //     // setCoordinateFrames(coordinateFrameList(curRenderer));

  //     // Prefer frames from [REP-105](https://www.ros.org/reps/rep-0105.html)
  //     for (const frameId of DEFAULT_FRAME_IDS) {
  //       if (curRenderer.transformTree.hasFrame(frameId)) {
  //         setDefaultFrame(frameId);
  //         return;
  //       }
  //     }

  //     // Choose the root frame with the most children
  //     const rootsToCounts = new Map<string, number>();
  //     for (const frame of curRenderer.transformTree.frames().values()) {
  //       const rootId = frame.root().id;
  //       rootsToCounts.set(rootId, (rootsToCounts.get(rootId) ?? 0) + 1);
  //     }
  //     const rootsArray = Array.from(rootsToCounts.entries());
  //     const rootId = rootsArray.sort((a, b) => b[1] - a[1])[0]?.[0];
  //     if (rootId != undefined) {
  //       setDefaultFrame(rootId);
  //     }
  //   },
  //   [setDefaultFrame],
  // );

  // Maintain a list of topic settings nodes with update handlers
  // const [topicSettingsNodes, setTopicSettingsNodes] = useState<
  //   Map<string, SettingsTreeNodeAndHandler<unknown> | undefined>
  // >(new Map());
  // const updateTopicSettingsNodes = useCallback(
  //   (newSettingsNodes: Map<string, SettingsTreeNodeAndHandler<unknown> | undefined>) =>
  //     setTopicSettingsNodes(newSettingsNodes),
  //   [],
  // );

  // Maintain a tree of settings node errors
  // const [layerErrors, setLayerErrors] = useState<NodeError>(new NodeError([]));
  // const updateLayerErrors = useCallback(
  //   (_: unknown, __: unknown, ___: unknown, curRenderer: Renderer) =>
  //     setLayerErrors(currenderer.settings.errors.errors.clone()),
  //   [],
  // );

  // Maintain the settings tree
  const [settingsTree, setSettingsTree] = useState<SettingsTreeRoots | undefined>(undefined);
  const updateSettingsTree = useCallback(
    (curRenderer: Renderer) => setSettingsTree(curRenderer.settings.tree()),
    [],
  );

  const updateConfig = useCallback((curRenderer: Renderer) => setConfig(curRenderer.config), []);

  // useRendererEvent("transformTreeUpdated", updateCoordinateFrames, renderer);
  // useRendererEvent("layerErrorUpdate", updateLayerErrors, renderer);
  useRendererEvent("settingsTreeChange", updateSettingsTree, renderer);
  useRendererEvent("configChange", updateConfig, renderer);
  // useRendererEvent("topicSettingsNodesUpdated", updateTopicSettingsNodes, renderer);

  // Set the rendering frame (aka followTf) based on the configured frame, falling back to a
  // heuristically chosen best frame for the current scene (defaultFrame)
  // const followTf = useMemo(
  //   () =>
  //     configFollowTf != undefined && renderer && renderer.transformTree.hasFrame(configFollowTf)
  //       ? configFollowTf
  //       : defaultFrame,
  //   [configFollowTf, defaultFrame, renderer],
  // );

  // const settingsNodeProviders = renderer?.settingsNodeProviders;

  // const throttledUpdatePanelSettingsTree = useDebouncedCallback(
  //   (handler: (action: SettingsTreeAction) => void, options: SettingsTreeOptions) => {
  //     // eslint-disable-next-line no-underscore-dangle
  //     (
  //       context as unknown as EXPERIMENTAL_PanelExtensionContextWithSettings
  //     ).__updatePanelSettingsTree({
  //       actionHandler: handler,
  //       roots: buildSettingsTree(options),
  //     });
  //   },
  //   250,
  //   { leading: true, trailing: true, maxWait: 250 },
  // );

  // useEffect(() => {
  //   throttledUpdatePanelSettingsTree(actionHandler, {
  //     config,
  //     coordinateFrames,
  //     layerErrors,
  //     followTf,
  //     topics: topics ?? [],
  //     topicsToLayerTypes,
  //     settingsNodeProviders: settingsNodeProviders ?? new Map(),
  //   });
  // }, [
  //   actionHandler,
  //   config,
  //   context,
  //   coordinateFrames,
  //   followTf,
  //   layerErrors,
  //   settingsNodeProviders,
  //   throttledUpdatePanelSettingsTree,
  //   topics,
  //   topicsToLayerTypes,
  // ]);

  useEffect(() => {
    // eslint-disable-next-line no-underscore-dangle
    (
      context as unknown as EXPERIMENTAL_PanelExtensionContextWithSettings
    ).__updatePanelSettingsTree({
      actionHandler,
      roots: settingsTree ?? {},
    });
  }, [actionHandler, context, settingsTree]);

  // Update the renderer's reference to `config` when it changes
  useEffect(() => {
    if (renderer) {
      renderer.config = config;
      renderRef.current.needsRender = true;
    }
  }, [config, renderer]);

  // Update the renderer's reference to `topics` when it changes
  useEffect(() => {
    if (renderer) {
      renderer.setTopics(topics);
      renderRef.current.needsRender = true;
    }
  }, [topics, renderer]);

  // Update renderer and draw a new frame when followTf changes
  // useEffect(() => {
  //   if (renderer?.config && followTf != undefined) {
  //     renderer.renderFrameId = followTf;
  //     renderRef.current.needsRender = true;
  //   }
  // }, [followTf, renderer]);

  // Save panel settings whenever they change
  const throttledSave = useDebouncedCallback(
    (newConfig: ThreeDeeRenderConfig) => saveState(newConfig),
    1000,
    { leading: false, trailing: true, maxWait: 1000 },
  );
  useEffect(() => throttledSave(config), [config, throttledSave]);

  // Dispose of the renderer (and associated GPU resources) on teardown
  useCleanup(() => renderer?.dispose());

  // We use a layout effect to setup render handling for our panel. We also setup some topic subscriptions.
  useLayoutEffect(() => {
    // The render handler is run by the broader studio system during playback when your panel
    // needs to render because the fields it is watching have changed. How you handle rendering depends on your framework.
    // You can only setup one render handler - usually early on in setting up your panel.
    //
    // Without a render handler your panel will never receive updates.
    //
    // The render handler could be invoked as often as 60hz during playback if fields are changing often.
    context.onRender = (renderState: RenderState, done) => {
      ReactDOM.unstable_batchedUpdates(() => {
        if (renderState.currentTime) {
          setCurrentTime(toNanoSec(renderState.currentTime));
        }

        // Set the done callback into a state variable to trigger a re-render
        setRenderDone(done);

        // Keep UI elements and the renderer aware of the current color scheme
        setColorScheme(renderState.colorScheme);

        // We may have new topics - since we are also watching for messages in
        // the current frame, topics may not have changed
        setTopics(renderState.topics);

        // currentFrame has messages on subscribed topics since the last render call
        if (renderState.currentFrame) {
          // Fully parse lazy messages
          for (const messageEvent of renderState.currentFrame) {
            const maybeLazy = messageEvent.message as { toJSON?: () => unknown };
            if ("toJSON" in maybeLazy) {
              (messageEvent as { message: unknown }).message = maybeLazy.toJSON!();
            }
          }
        }
        setMessages(renderState.currentFrame);
      });
    };

    context.watch("currentTime");
    context.watch("colorScheme");
    context.watch("topics");
    context.watch("currentFrame");
  }, [context]);

  // Build a list of topics to subscribe to
  const [topicsToSubscribe, setTopicsToSubscribe] = useState<string[] | undefined>(undefined);
  useEffect(() => {
    const subscriptions = new Set<string>();
    if (!topics) {
      setTopicsToSubscribe(undefined);
      return;
    }

    for (const topic of topics) {
      // Subscribe to all transform topics
      if (TF_DATATYPES.has(topic.datatype) || TRANSFORM_STAMPED_DATATYPES.has(topic.datatype)) {
        subscriptions.add(topic.name);
      } else if (datatypeHandlers.has(topic.datatype)) {
        // Subscribe to known datatypes if the topic has not been toggled off
        const topicConfig = config.topics[topic.name] as Partial<LayerSettings> | undefined;
        if (topicConfig?.visible !== false) {
          subscriptions.add(topic.name);
        }
      }
      // } else if (SUPPORTED_DATATYPES.has(topic.datatype)) {
      //   // Subscribe to known datatypes if the topic has not been toggled off
      //   const topicConfig = config.topics[topic.name] as Partial<LayerSettings> | undefined;
      //   if (topicConfig?.visible !== false) {
      //     subscriptions.add(topic.name);
      //   }
      // }
    }

    // For camera image topics, subscribe to their corresponding sensor_msgs/CameraInfo topic
    // for (const configEntry of Object.values(config.topics)) {
    //   const topicConfig = configEntry as Partial<LayerSettingsImage> | undefined;
    //   if (topicConfig?.visible !== false && topicConfig?.cameraInfoTopic != undefined) {
    //     subscriptions.add(topicConfig.cameraInfoTopic);
    //   }
    // }

    const newTopics = Array.from(subscriptions.keys()).sort();
    setTopicsToSubscribe((prevTopics) => (isEqual(prevTopics, newTopics) ? prevTopics : newTopics));
  }, [topics, config.topics, datatypeHandlers]);

  // Notify the extension context when our subscription list changes
  useEffect(() => {
    if (!topicsToSubscribe) {
      return;
    }
    log.debug(`Subscribing to [${topicsToSubscribe.join(", ")}]`);
    context.subscribe(topicsToSubscribe);
  }, [context, topicsToSubscribe]);

  // Keep the renderer currentTime up to date
  useEffect(() => {
    if (renderer && currentTime != undefined) {
      renderer.currentTime = currentTime;
      renderRef.current.needsRender = true;
    }
  }, [currentTime, renderer]);

  // Keep the renderer colorScheme and backgroundColor up to date
  useEffect(() => {
    if (colorScheme && renderer) {
      renderer.setColorScheme(colorScheme, backgroundColor);
      renderRef.current.needsRender = true;
    }
  }, [backgroundColor, colorScheme, renderer]);

  // Handle messages and render a frame if new messages are available
  useEffect(() => {
    if (!renderer || !messages) {
      return;
    }

    for (const message of messages) {
      const datatype = topicsToDatatypes.get(message.topic);
      if (!datatype) {
        continue;
      }

      renderer.addMessageEvent(message, datatype);
    }

    renderRef.current.needsRender = true;
  }, [messages, renderer, topicsToDatatypes]);

  // Update the renderer when the camera moves
  useEffect(() => {
    cameraStore.setCameraState(cameraState);
    renderer?.setCameraState(cameraState);
    renderRef.current.needsRender = true;
  }, [cameraState, cameraStore, renderer]);

  useEffect(() => {
    // Render a new frame if requested
    if (renderer && renderRef.current.needsRender) {
      renderer.animationFrame();
      renderRef.current.needsRender = false;
    }
  });

  // Invoke the done callback once the render is complete
  useEffect(() => {
    renderDone?.();
  }, [renderDone]);

  // Use a debounce and 0 refresh rate to avoid triggering a resize observation while handling
  // an existing resize observation.
  // https://github.com/maslianok/react-resize-detector/issues/45
  const {
    ref: resizeRef,
    width,
    height,
  } = useResizeDetector({
    refreshRate: 0,
    refreshMode: "debounce",
  });
  return (
    <div
      style={{ width: "100%", height: "100%", display: "flex", position: "relative" }}
      ref={resizeRef}
    >
      <CameraListener cameraStore={cameraStore} shiftKeys={true}>
        <div
          // This element forces CameraListener to fill its container. We need this instead of just
          // the canvas since three.js manages the size of the canvas element and we use position:absolute.
          style={{ width, height }}
        />
        <canvas ref={setCanvas} style={{ position: "absolute", top: 0, left: 0 }} />
      </CameraListener>
      <RendererContext.Provider value={renderer}>
        <RendererOverlay enableStats={config.scene.enableStats ?? true} />
      </RendererContext.Provider>
    </div>
  );
}

// function settingsTreeActionHandler(
//   action: SettingsTreeAction,
//   renderer: Renderer | ReactNull,
//   setConfig: React.Dispatch<React.SetStateAction<ThreeDeeRenderConfig>>,
//   renderRef: React.MutableRefObject<{ needsRender: boolean }>,
//   // topicsToLayerTypes: Map<string, LayerType>,
// ) {
//   setConfig((oldConfig) => {
//     if (action.action === "perform-node-action") {
//       log.debug(`[${action.action}][${action.payload.id}]`);

//       if (!renderer) {
//         return oldConfig;
//       }

//       const [actionId, actionLayerId] = action.payload.id.split(" ");
//       if (actionId === "add-grid" && actionLayerId != undefined) {
//         log.debug(`Creating grid layer ${actionLayerId}`);
//         const layerConfig = { label: "Grid", type: LayerType.Grid, visible: true };
//         const newConfig = produce(oldConfig, (draft) =>
//           set(draft, [...action.payload.path, actionLayerId], layerConfig),
//         );

//         updateLayerSettings(renderer, actionLayerId, layerConfig.type, layerConfig);
//         renderRef.current.needsRender = true;
//         return newConfig;
//       } else if (action.payload.id === "delete") {
//         const pathLayerId = action.payload.path[action.payload.path.length - 1]!;
//         const layerConfig = get(oldConfig, action.payload.path) as
//           | Partial<CustomLayerSettings>
//           | undefined;
//         const newConfig = produce(oldConfig, (draft) => void unset(draft, action.payload.path));

//         if (layerConfig?.type != undefined) {
//           updateLayerSettings(renderer, pathLayerId, layerConfig.type, undefined);
//         }
//         renderRef.current.needsRender = true;
//         return newConfig;
//       } else {
//         return oldConfig;
//       }
//     } else {
//       const newConfig = produce(oldConfig, (draft) =>
//         set(draft, action.payload.path, action.payload.value),
//       );

//       if (renderer) {
//         const basePath = action.payload.path[0];
//         if (basePath === "transforms") {
//           // A transform setting was changed, inform the renderer about it and
//           // draw a new frame
//           const frameId = action.payload.path[1]!;
//           const transformConfig = newConfig.transforms[frameId];
//           if (transformConfig) {
//             renderer.setTransformSettings(frameId, transformConfig);
//             renderRef.current.needsRender = true;
//           }
//         } else if (basePath === "topics") {
//           // A topic setting was changed, inform the renderer about it and
//           // draw a new frame
//           // const topic = action.payload.path[1]!;
//           // renderer.setTopicSettings(topic, newConfig);
//           renderRef.current.needsRender = true;
//         } else if (basePath === "layers") {
//           // A custom layer setting was changed, inform the renderer about
//           // it and draw a new frame
//           const layerId = action.payload.path[1]!;
//           const layerConfig = newConfig.layers[layerId];
//           if (layerConfig != undefined) {
//             updateLayerSettings(renderer, layerId, layerConfig.type, layerConfig);
//             renderRef.current.needsRender = true;
//           }
//         }
//       }

//       return newConfig;
//     }
//   });
// }

// function coordinateFrameList(renderer: Renderer | ReactNull | undefined): SelectEntry[] {
//   if (!renderer) {
//     return [];
//   }

//   type FrameEntry = { id: string; children: FrameEntry[] };

//   const frames = Array.from(renderer.transformTree.frames().values());
//   const frameMap = new Map<string, FrameEntry>(
//     frames.map((frame) => [frame.id, { id: frame.id, children: [] }]),
//   );

//   // Create a hierarchy of coordinate frames
//   const rootFrames: FrameEntry[] = [];
//   for (const frame of frames) {
//     const frameEntry = frameMap.get(frame.id)!;
//     const parentId = frame.parent()?.id;
//     if (parentId == undefined) {
//       rootFrames.push(frameEntry);
//     } else {
//       const parent = frameMap.get(parentId);
//       if (parent == undefined) {
//         continue;
//       }
//       parent.children.push(frameEntry);
//     }
//   }

//   // Convert the `rootFrames` hierarchy into a flat list of coordinate frames with depth
//   const output: SelectEntry[] = [];

//   function addFrame(frame: FrameEntry, depth: number) {
//     const frameName =
//       frame.id === "" || frame.id.startsWith(" ") || frame.id.endsWith(" ")
//         ? `"${frame.id}"`
//         : frame.id;
//     output.push({
//       value: frame.id,
//       label: `${"\u00A0\u00A0".repeat(depth)}${frameName}`,
//     });
//     frame.children.sort((a, b) => a.id.localeCompare(b.id));
//     for (const child of frame.children) {
//       addFrame(child, depth + 1);
//     }
//   }

//   rootFrames.sort((a, b) => a.id.localeCompare(b.id));
//   for (const entry of rootFrames) {
//     addFrame(entry, 0);
//   }

//   return output;
// }

// function buildTopicsToLayerTypes(topics: ReadonlyArray<Topic> | undefined): Map<string, LayerType> {
//   const map = new Map<string, LayerType>();
//   if (!topics) {
//     return map;
//   }
//   for (const topic of topics) {
//     const datatype = topic.datatype;
//     if (SUPPORTED_DATATYPES.has(datatype)) {
//       if (TF_DATATYPES.has(datatype) || TRANSFORM_STAMPED_DATATYPES.has(datatype)) {
//         map.set(topic.name, LayerType.Transform);
//       } else if (MARKER_DATATYPES.has(datatype) || MARKER_ARRAY_DATATYPES.has(datatype)) {
//         map.set(topic.name, LayerType.Marker);
//       } else if (OCCUPANCY_GRID_DATATYPES.has(datatype)) {
//         map.set(topic.name, LayerType.OccupancyGrid);
//       } else if (POINTCLOUD_DATATYPES.has(datatype)) {
//         map.set(topic.name, LayerType.PointCloud);
//       } else if (
//         POSE_STAMPED_DATATYPES.has(datatype) ||
//         POSE_WITH_COVARIANCE_STAMPED_DATATYPES.has(datatype)
//       ) {
//         map.set(topic.name, LayerType.Pose);
//       } else if (CAMERA_INFO_DATATYPES.has(datatype)) {
//         map.set(topic.name, LayerType.CameraInfo);
//       } else if (IMAGE_DATATYPES.has(datatype) || COMPRESSED_IMAGE_DATATYPES.has(datatype)) {
//         map.set(topic.name, LayerType.Image);
//       }
//     }
//   }
//   return map;
// }

function updateLayerSettings(
  renderer: Renderer,
  id: string,
  layerType: LayerType,
  layerConfig: Partial<CustomLayerSettings> | undefined,
) {
  // If visibility is toggled off for this layer, clear its layer errors
  if (layerConfig?.visible === false) {
    renderer.settings.errors.clearPath(["layers", id]);
  }

  switch (layerType) {
    case LayerType.Grid:
      // renderer.setGridSettings(id, layerConfig as Partial<LayerSettingsGrid> | undefined);
      break;
    default:
      throw new Error(`Attempted to update layer settings for type ${layerType} (id "${id}")`);
  }
}
