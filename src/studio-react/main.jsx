import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import {
  Background,
  BackgroundVariant,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  getBezierPath,
  useReactFlow,
  useViewport,
} from "@xyflow/react";
import "@mantine/core/styles.css";
import "@xyflow/react/dist/style.css";
import "./studio.css";

const DEFAULT_VIDEO_TABS = [
  "文生视频",
  "全能参考",
  "图生视频",
  "首尾帧",
  "图片参考",
];

const DEFAULT_IMAGE_SIZES = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"];
const DEFAULT_VIDEO_RATIOS = ["9:16", "16:9", "1:1", "4:3", "3:4", "auto"];
const DEFAULT_VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"];
const JIANYING_VIDEO_MODEL_OPTIONS = [
  { value: "seedance2.0_vision", label: "Seedance 2.0 质量" },
  { value: "seedance2.0_fast_vision", label: "Seedance 2.0 快速" },
];
const JIANYING_STYLE_SNAPSHOTS = [
  {
    category: "真人",
    modelKey: "AnyDream_2.0",
    styleId: "1780651424491_style",
    stylePeAfter:
      "真人写实风格，摄影作品，画面具有60年代复古科幻质感，色调以复古暖橙、海盐蓝、高对比低饱和胶片色彩为主，带明显胶片颗粒、轻微复古胶片柔光和自然日光光晕。光影上使用自然日光、强直射日光和清晰投影，画面明暗对比强烈，高光不过曝，暗部保留完整细节，明暗过渡自然，整体呈现自然立体、怀旧、精致的原子朋克电影感。",
    stylePeBefore: "60年代复古科幻原子朋克美学，复古未来主义影像风格",
    stylePosition: "both",
    title: "复古科幻原子朋克",
    version: "1780651831",
  },
  {
    category: "真人",
    modelKey: "AnyDream_2.0",
    styleId: "1779094923778_style",
    stylePeAfter:
      "真人写实风格，摄影作品，整体风格包含紧张、粗粝，色调以去饱和、低饱和柔和色调、低调为主，光影上使用环境光、柔和阴影。",
    stylePeBefore: "参考电影为《MemoriesMurder》，",
    stylePosition: "both",
    title: "韩国冷淡风电影风格",
    version: "1779703621",
  },
  {
    category: "真人",
    modelKey: "AnyDream_2.0",
    styleId: "1779094923776_style",
    stylePeAfter:
      "真人写实风格，摄影作品，整体风格包含复古、工业感，色调以低调、微弱amber辉光为主。",
    stylePeBefore: "参考电影为《NineteenEighty-Four》，",
    stylePosition: "both",
    title: "老式工业影视风格",
    version: "1779703621",
  },
];
const JIANYING_CAMERA_MOTIONS = [
  { value: "", label: "不指定", tokenLabel: "" },
  { value: "static_shot", label: "固定镜头", tokenLabel: "运镜·固定镜头" },
  { value: "profile_tracking", label: "侧面跟拍", tokenLabel: "运镜·侧面跟拍" },
  { value: "push_in", label: "缓慢推近", tokenLabel: "运镜·缓慢推近" },
  { value: "orbit", label: "环绕运镜", tokenLabel: "运镜·环绕运镜" },
];
const VIDEO_MODE_TYPES = [
  { value: "text2video", label: "文生视频" },
  { value: "singleImage2video", label: "单图首帧" },
  { value: "frames2video", label: "首尾帧" },
  { value: "image2video", label: "图生视频" },
  { value: "video2video", label: "视频参考" },
  { value: "videoEdit2video", label: "视频编辑" },
  { value: "audio2video", label: "音频驱动" },
  { value: "mixed2video", label: "全能参考" },
];
const IMAGE_MODE_TYPES = [
  { value: "text2image", label: "文生图" },
  { value: "image2image", label: "参考生图" },
];
const SLASH_COMMANDS = [
  {
    id: "cinematic",
    label: "电影感",
    category: "风格",
    icon: "C",
    insertText: "电影感光影，真实镜头质感，细腻构图，高级色彩",
  },
  {
    id: "product",
    label: "产品展示",
    category: "商业",
    icon: "P",
    insertText: "产品主体清晰突出，商业广告构图，干净背景，高级布光",
  },
  {
    id: "character",
    label: "角色一致",
    category: "人物",
    icon: "R",
    insertText: "保持角色五官、发型、服饰和气质一致，表情自然",
  },
  {
    id: "camera-push",
    label: "镜头推进",
    category: "运镜",
    icon: "→",
    insertText: "镜头缓慢向主体推进，运动平滑，焦点稳定",
  },
  {
    id: "negative",
    label: "负面词",
    category: "修正",
    icon: "!",
    insertText: "避免低清晰度、畸形、错手、文字乱码、水印、过曝、模糊",
  },
];
const REFERENCE_MIME = "application/x-liblib-reference";
const MENTION_MIME = "application/x-liblib-mention";

let mountedRoot = null;
let mountedElement = null;

function mount(element, bridge) {
  if (!element || !bridge) return;
  if (mountedRoot && mountedElement !== element) {
    mountedRoot.unmount();
    mountedRoot = null;
  }
  mountedElement = element;
  if (!mountedRoot) mountedRoot = createRoot(element);
  mountedRoot.render(
    <React.StrictMode>
      <MantineProvider defaultColorScheme="dark">
        <ReactFlowProvider>
          <StudioApp bridge={bridge} />
        </ReactFlowProvider>
      </MantineProvider>
    </React.StrictMode>,
  );
}

function unmount() {
  mountedRoot?.unmount();
  mountedRoot = null;
  mountedElement = null;
}

function StudioApp({ bridge }) {
  const [snapshot, setSnapshot] = useState(() => bridge.getSnapshot());

  useEffect(() => {
    setSnapshot(bridge.getSnapshot());
    return bridge.subscribe((nextSnapshot) => {
      setSnapshot(nextSnapshot);
    });
  }, [bridge]);

  const workflow = snapshot.workflow;

  if (!workflow) {
    return (
      <div className="dreame-studio dreame-studio-empty">
        <div className="studio-empty-panel">
          <strong>画板数据未加载</strong>
          <button type="button" onClick={() => bridge.reload()}>
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dreame-studio" data-studio-react-root="true">
      <input
        id="canvasFileInput"
        type="file"
        accept="image/*,audio/*,video/*,.txt,.md"
        hidden
        onChange={(event) => bridge.handleUpload(event.nativeEvent)}
      />
      <StudioTopbar snapshot={snapshot} bridge={bridge} />
      <div className="studio-canvas-shell">
        <StudioFlow snapshot={snapshot} bridge={bridge} />
        <StudioSidebar snapshot={snapshot} bridge={bridge} />
        <HistoryPanel snapshot={snapshot} bridge={bridge} />
        <StudioDrawer snapshot={snapshot} bridge={bridge} />
      </div>
    </div>
  );
}

function StudioTopbar({ snapshot, bridge }) {
  const workflow = snapshot.workflow;
  const [title, setTitle] = useState(workflow.title || "未命名画板");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setTitle(workflow.title || "未命名画板");
  }, [workflow.id, workflow.title]);

  const commitTitle = useCallback(() => {
    const next = title.trim();
    if (!next) {
      setTitle(workflow.title || "未命名画板");
      bridge.toast("画板标题不能为空");
      return;
    }
    if (next !== workflow.title) bridge.renameWorkflow(next);
  }, [bridge, title, workflow.title]);

  return (
    <header className="studio-topbar">
      <a className="studio-brand" href="#/">
        <span>D</span>
        <strong>DreameHub</strong>
      </a>

      <div className="studio-workflow-switcher">
        <input
          className="studio-title-input"
          value={title}
          maxLength={80}
          aria-label="画板标题"
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setTitle(workflow.title || "未命名画板");
              event.currentTarget.blur();
            }
          }}
        />
        <button
          type="button"
          className="studio-menu-toggle"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {workflow.title || "未命名画板"}
          <span>⌄</span>
        </button>
        {menuOpen ? (
          <div className="studio-workflow-menu" role="menu">
            {snapshot.workflows.map((item) => (
              <div
                className={`studio-workflow-row ${
                  item.id === snapshot.selectedWorkflowId ? "active" : ""
                }`}
                key={item.id}
              >
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    bridge.switchWorkflow(item.id);
                  }}
                >
                  <strong>{item.title || "未命名画板"}</strong>
                  <span>
                    {item.id === snapshot.selectedWorkflowId
                      ? "当前"
                      : `${item.nodeCount || 0} 节点`}
                  </span>
                </button>
                <button
                  type="button"
                  className="danger"
                  title="删除画板"
                  onClick={() => bridge.deleteWorkflow(item.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <button
          className="studio-icon-btn"
          type="button"
          title="新建画板"
          onClick={() => bridge.createWorkflow()}
        >
          +
        </button>
      </div>

      <div className="studio-top-actions">
        <a className="studio-credit-pill" href="#/pricing">
          <span>Credits</span>
          <strong>{snapshot.credits ?? 0}</strong>
        </a>
      </div>
    </header>
  );
}

function StudioFlow({ snapshot, bridge }) {
  const reactFlow = useReactFlow();
  const draggingRef = useRef(false);
  const ignorePaneClickRef = useRef(false);
  const ignorePaneTimerRef = useRef(null);
  const interactionTimerRef = useRef(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [isInteracting, setIsInteracting] = useState(false);
  const [pendingConnectionSource, setPendingConnectionSource] = useState("");
  const flowNodesFromSnapshot = useMemo(
    () =>
      toFlowNodes(
        snapshot,
        bridge,
        pendingConnectionSource,
        (nodeId, handleType) => {
          if (handleType === "source") {
            setPendingConnectionSource((current) =>
              current === nodeId ? "" : nodeId,
            );
            return;
          }
          if (!pendingConnectionSource || pendingConnectionSource === nodeId) {
            return;
          }
          bridge.connectNodes(pendingConnectionSource, nodeId);
          setPendingConnectionSource("");
        },
      ),
    [bridge, pendingConnectionSource, snapshot],
  );
  const flowEdgesFromSnapshot = useMemo(
    () => toFlowEdges(snapshot, bridge, selectedEdgeId, setSelectedEdgeId),
    [bridge, selectedEdgeId, snapshot],
  );
  const [nodes, setNodes] = useState(flowNodesFromSnapshot);
  const [edges, setEdges] = useState(flowEdgesFromSnapshot);

  useEffect(() => {
    if (!draggingRef.current) setNodes(flowNodesFromSnapshot);
    setEdges(flowEdgesFromSnapshot);
  }, [flowEdgesFromSnapshot, flowNodesFromSnapshot]);

  useEffect(() => {
    if (!selectedEdgeId) return;
    if (!flowEdgesFromSnapshot.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId("");
    }
  }, [flowEdgesFromSnapshot, selectedEdgeId]);

  useEffect(
    () => () => {
      if (ignorePaneTimerRef.current) clearTimeout(ignorePaneTimerRef.current);
      if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
    },
    [],
  );

  const beginInteraction = useCallback(() => {
    if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
    setIsInteracting(true);
  }, []);

  const endInteraction = useCallback(() => {
    if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
    interactionTimerRef.current = setTimeout(() => {
      setIsInteracting(false);
    }, 120);
  }, []);

  useEffect(() => {
    const stopInteraction = () => endInteraction();
    window.addEventListener("pointerup", stopInteraction, true);
    window.addEventListener("pointercancel", stopInteraction, true);
    window.addEventListener("mouseup", stopInteraction, true);
    window.addEventListener("blur", stopInteraction);
    return () => {
      window.removeEventListener("pointerup", stopInteraction, true);
      window.removeEventListener("pointercancel", stopInteraction, true);
      window.removeEventListener("mouseup", stopInteraction, true);
      window.removeEventListener("blur", stopInteraction);
    };
  }, [endInteraction]);

  const markPaneClickIgnored = useCallback((event) => {
    if (!isCanvasControlTarget(event.target)) return;
    ignorePaneClickRef.current = true;
    if (ignorePaneTimerRef.current) clearTimeout(ignorePaneTimerRef.current);
    ignorePaneTimerRef.current = setTimeout(() => {
      ignorePaneClickRef.current = false;
    }, 500);
  }, []);

  const shouldIgnorePaneClick = useCallback((event) => {
    if (ignorePaneClickRef.current || isCanvasControlTarget(event.target)) {
      ignorePaneClickRef.current = false;
      return true;
    }
    return false;
  }, []);

  const onNodesChange = useCallback((changes) => {
    setNodes((items) => applyNodeChanges(changes, items));
  }, []);

  const deleteSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) return;
    const edge = edges.find((item) => item.id === selectedEdgeId);
    if (!edge) return;
    bridge.deleteEdge(edge.data);
    setSelectedEdgeId("");
  }, [bridge, edges, selectedEdgeId]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!selectedEdgeId) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      deleteSelectedEdge();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteSelectedEdge, selectedEdgeId]);

  const addNodeAtPointer = useCallback(
    (event, type = "text") => {
      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      bridge.addNode(type, position);
    },
    [bridge, reactFlow],
  );

  return (
    <main
      className={`studio-flow-frame ${isInteracting ? "canvas-interacting" : ""}`}
      onPointerDownCapture={markPaneClickIgnored}
      onPointerUpCapture={endInteraction}
      onPointerCancelCapture={endInteraction}
      onMouseDownCapture={markPaneClickIgnored}
      onMouseUpCapture={endInteraction}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => {
          setSelectedEdgeId("");
          bridge.selectNode(node.id);
        }}
        onEdgeClick={(event, edge) => {
          event.stopPropagation();
          setSelectedEdgeId(edge.id);
          bridge.selectNode("");
        }}
        onPaneClick={(event) => {
          if (shouldIgnorePaneClick(event)) return;
          setSelectedEdgeId("");
          bridge.selectNode("");
        }}
        onPaneDoubleClick={(event) => {
          if (shouldIgnorePaneClick(event)) return;
          addNodeAtPointer(event, "text");
        }}
        onConnect={(connection) =>
          {
            bridge.connectNodes(connection.source, connection.target);
            setPendingConnectionSource("");
          }
        }
        onConnectStart={beginInteraction}
        onConnectEnd={endInteraction}
        onNodeDragStart={() => {
          draggingRef.current = true;
          beginInteraction();
        }}
        onNodeDragStop={(_, node) => {
          draggingRef.current = false;
          bridge.moveNode(node.id, node.position);
          endInteraction();
        }}
        onMoveStart={beginInteraction}
        onMoveEnd={(_, viewport) => {
          bridge.setViewport(viewport);
          endInteraction();
        }}
        defaultViewport={{
          x: snapshot.viewport?.x ?? 0,
          y: snapshot.viewport?.y ?? 0,
          zoom: snapshot.viewport?.zoom ?? 0.9,
        }}
        minZoom={0.18}
        maxZoom={2.4}
        fitView={false}
        panOnScroll
        panOnDrag
        zoomOnPinch
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        onlyRenderVisibleElements
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        proOptions={{ hideAttribution: true }}
        connectionLineStyle={{
          stroke: "#8edcff",
          strokeWidth: 2,
          filter: "drop-shadow(0 0 8px rgba(73, 201, 255, .75))",
        }}
        defaultEdgeOptions={{
          type: "bezier",
          markerEnd: { type: MarkerType.ArrowClosed },
          style: {
            stroke: "rgba(124, 210, 255, 0.86)",
            strokeWidth: 2,
          },
        }}
      >
        <Background
          color="rgba(255,255,255,.12)"
          gap={22}
          size={1.1}
          variant={BackgroundVariant.Dots}
        />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      {snapshot.workflow.nodes.length ? null : (
        <div className="studio-empty-canvas">
          <strong>双击画布或点击底部按钮添加节点</strong>
          <span>连接线、选择、拖拽、缩放现在由真实 ReactFlow 处理。</span>
        </div>
      )}
    </main>
  );
}

function toFlowNodes(
  snapshot,
  bridge,
  pendingConnectionSource = "",
  onHandleClick = () => {},
) {
  const workflow = snapshot.workflow;
  return (workflow.nodes || []).map((node, index) => {
    const width = Number(node.width || node.displayWidth || 0) || defaultNodeWidth(node);
    const position = {
      x: Number.isFinite(Number(node.x)) ? Number(node.x) : 240 + index * 320,
      y: Number.isFinite(Number(node.y)) ? Number(node.y) : 180 + index * 36,
    };
    return {
      id: node.id,
      type: "dreame",
      position,
      selected: node.id === snapshot.selectedNodeId,
      data: {
        node,
        width,
        snapshot,
        bridge,
        references: referenceAssetsForNode(node, workflow),
        pendingConnectionSource,
        onHandleClick,
      },
      style: {
        width,
        zIndex: node.id === snapshot.selectedNodeId ? 10 : 0,
      },
    };
  });
}

function toFlowEdges(snapshot, bridge, selectedEdgeId = "", selectEdge = () => {}) {
  return (snapshot.workflow.links || [])
    .filter((link) => link.from && link.to)
    .map((link, index) => {
      const id = link.id || `e-${link.from}-${link.to}-${index}`;
      const isSelected = id === selectedEdgeId;
      return {
        id,
        source: link.from,
        target: link.to,
        type: "dreame",
        selected: isSelected,
        animated: isSelected || (snapshot.selectedNodeId
          ? link.from === snapshot.selectedNodeId || link.to === snapshot.selectedNodeId
          : false),
        markerEnd: { type: MarkerType.ArrowClosed },
        className: "studio-flow-edge",
        data: {
          bridge,
          from: link.from,
          id,
          index,
          selectEdge,
          selected: isSelected,
          to: link.to,
        },
      };
    });
}

function StudioEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  data,
}) {
  const [hovered, setHovered] = useState(false);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const isActive = Boolean(selected || hovered);
  const selectEdge = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    data?.selectEdge?.(id);
    data?.bridge?.selectNode?.("");
  }, [data, id]);
  const deleteEdge = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    data?.bridge?.deleteEdge?.(data);
  }, [data]);

  return (
    <>
      <path
        className="studio-edge-hit"
        d={edgePath}
        fill="none"
        stroke="rgba(0,0,0,0.001)"
        strokeWidth={22}
        style={{ cursor: "pointer", pointerEvents: "stroke" }}
        onClick={selectEdge}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={(event) => event.stopPropagation()}
      />
      <path
        id={id}
        className="react-flow__edge-path studio-edge-path"
        d={edgePath}
        fill="none"
        markerEnd={markerEnd}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      />
      <g className="edge-flow-segments" style={{ pointerEvents: "none" }}>
        <path className="studio-edge-flow" d={edgePath} fill="none" />
      </g>
      {isActive ? (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="studio-edge-delete scissors-enter nodrag nopan nowheel"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            title="删除连接线"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={deleteEdge}
          >
            ✂
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const StudioNode = memo(function StudioNode({ id, data, selected }) {
  const {
    node,
    width,
    bridge,
    snapshot,
    references,
    pendingConnectionSource,
    onHandleClick,
  } = data;
  const source = mediaSource(node);
  const title = node.title || node.displayName || node.label || node.type || "节点";
  const isSelected = selected || snapshot.selectedNodeId === id;
  const isConnectionSource = pendingConnectionSource === id;
  const isConnectionTarget = Boolean(
    pendingConnectionSource && pendingConnectionSource !== id,
  );
  const [draftTitle, setDraftTitle] = useState(title);

  useEffect(() => {
    setDraftTitle(title);
  }, [title]);

  const triggerManualHandle = useCallback(
    (event, handleType) => {
      event.preventDefault();
      event.stopPropagation();
      onHandleClick?.(id, handleType);
    },
    [id, onHandleClick],
  );

  const commitTitle = useCallback(() => {
    const next = draftTitle.trim();
    if (next && next !== title) bridge.renameNode(id, next);
    if (!next) setDraftTitle(title);
  }, [bridge, draftTitle, id, title]);

  return (
    <div
      className={`studio-node node-shell relative studio-node-${node.type || "text"} ${
        isSelected ? "selected" : ""
      } ${isConnectionSource ? "linking-source" : ""} ${
        isConnectionTarget ? "linking-target" : ""
      }`}
      style={{ width }}
      data-nodeid={id}
      data-ref-pickable="1"
      data-longpress-contextmenu
    >
      <div className="studio-node-title node-floating-ui transition-[transform,opacity] duration-150 ease-out absolute left-0 origin-bottom-left nodrag nopan">
        <span className="studio-node-type">{nodeIcon(node)}</span>
        <span
          className="studio-node-title-edit"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onInput={(event) => setDraftTitle(event.currentTarget.textContent || "")}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDraftTitle(title);
              event.currentTarget.textContent = title;
              event.currentTarget.blur();
            }
          }}
        >
          {draftTitle}
        </span>
        <em>{nodeMeta(node, references)}</em>
      </div>

      <div className="studio-node-card">
        <Handle
          className="studio-handle studio-handle-left"
          type="target"
          position={Position.Left}
          aria-label="连接输入"
          data-rf-handle="target"
        />
        <button
          type="button"
          className="studio-link-button studio-link-button-left nodrag nopan nowheel"
          aria-label="连接输入"
          data-link-handle="target"
          onPointerDownCapture={(event) => triggerManualHandle(event, "target")}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          +
        </button>
        <NodeMedia node={node} source={source} />
        <NodeProgress node={node} />
        <div className="studio-node-actions nodrag nopan">
          <button
            type="button"
            title="上传/替换"
            onClick={(event) => {
              event.stopPropagation();
              bridge.uploadNode(id);
            }}
          >
            ⇧
          </button>
          {source ? (
            <button
              type="button"
              title="下载到本地"
              onClick={(event) => {
                event.stopPropagation();
                bridge.downloadNode(id);
              }}
            >
              ⇩
            </button>
          ) : null}
          <button
            type="button"
            title="复制节点"
            onClick={(event) => {
              event.stopPropagation();
              bridge.duplicateNode(id);
            }}
          >
            ⧉
          </button>
          <button
            type="button"
            title="删除节点"
            onClick={(event) => {
              event.stopPropagation();
              bridge.deleteNode(id);
            }}
          >
            ×
          </button>
        </div>
        <Handle
          className="studio-handle studio-handle-right"
          type="source"
          position={Position.Right}
          aria-label="连接输出"
          data-rf-handle="source"
        />
        <button
          type="button"
          className="studio-link-button studio-link-button-right nodrag nopan nowheel"
          aria-label="连接输出"
          data-link-handle="source"
          onPointerDownCapture={(event) => triggerManualHandle(event, "source")}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          +
        </button>
      </div>

      <div className="studio-node-flowmeta">
        {references.length ? `引用 ${references.length}` : node.referenceStatus || ""}
      </div>

      {isSelected ? (
        <NodeComposer
          node={node}
          snapshot={snapshot}
          references={references}
          bridge={bridge}
        />
      ) : null}
    </div>
  );
});

const nodeTypes = { dreame: StudioNode };
const edgeTypes = { dreame: StudioEdge };

function NodeMedia({ node, source }) {
  if (node.type === "image") {
    return source ? (
      <img className="studio-media" src={source} alt={node.title || "图片节点"} />
    ) : (
      <div className="studio-node-placeholder">图片节点</div>
    );
  }
  if (node.type === "video") {
    return source ? (
      <video className="studio-media" src={source} controls playsInline />
    ) : (
      <div className="studio-node-placeholder large">视频节点</div>
    );
  }
  if (node.type === "audio") {
    return (
      <div className="studio-text-node">
        <p>{node.content || node.label || "音频素材"}</p>
        {source ? <audio src={source} controls /> : null}
      </div>
    );
  }
  return (
    <div className="studio-text-node">
      <p>{node.content || node.label || "文本节点"}</p>
    </div>
  );
}

function NodeProgress({ node }) {
  const job = node.activeGenerationJob;
  if (!job) return null;
  const percent = Number(job.progress?.percent || 0) || (job.status === "running" ? 12 : 2);
  return (
    <div className="studio-progress-card">
      <span>{job.progress?.label || job.message || "正在生成"}</span>
      <i>
        <b style={{ width: `${Math.max(2, Math.min(100, percent))}%` }} />
      </i>
    </div>
  );
}

function NodeComposer({ node, snapshot, references, bridge }) {
  const kind = composerKind(node);
  const { zoom } = useViewport();
  const [prompt, setPrompt] = useState(node.promptDraft || node.content || snapshot.prompt || "");
  const [settings, setSettings] = useState(() => node.generationSettings || {});
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [queuedReference, setQueuedReference] = useState(null);
  const promptCommitTimer = useRef(null);
  const referenceCandidatesForNode = useMemo(
    () => referenceCandidates(snapshot.assets || [], node, references, ""),
    [node, references, snapshot.assets],
  );

  useEffect(() => {
    setPrompt(node.promptDraft || node.content || snapshot.prompt || "");
    setSettings(node.generationSettings || {});
  }, [node.id, node.content, node.generationSettings, node.promptDraft, snapshot.prompt]);

  useEffect(() => () => clearTimeout(promptCommitTimer.current), []);

  const updateSetting = useCallback(
    (key, value) => {
      const next = { ...settings, [key]: value };
      setSettings(next);
      bridge.updateNodeSettings(node.id, { [key]: value });
    },
    [bridge, node.id, settings],
  );

  const updatePrompt = useCallback(
    (value, { commit = false } = {}) => {
      setPrompt(value);
      clearTimeout(promptCommitTimer.current);
      const hidden = document.querySelector("#promptInput");
      if (hidden) hidden.value = value;
      if (commit) {
        bridge.updateNodePrompt(node.id, value);
      } else {
        promptCommitTimer.current = setTimeout(() => {
          bridge.updateNodePrompt(node.id, value, { silent: true });
        }, 600);
      }
    },
    [bridge, node.id],
  );

  const pickReference = useCallback(
    (asset, nextPrompt = null) => {
      if (!asset?.id) return;
      const label = assetLabel(asset);
      const promptWithMention =
        typeof nextPrompt === "string" ? nextPrompt : appendMentionText(prompt, label);
      updatePrompt(promptWithMention, { commit: true });
      bridge.referenceAsset(node.id, asset.id);
      setReferencePickerOpen(false);
    },
    [bridge, node.id, prompt, updatePrompt],
  );

  const queueReferencePick = useCallback((asset) => {
    if (!asset?.id) return;
    setQueuedReference({ asset, nonce: Date.now() });
    setReferencePickerOpen(false);
  }, []);

  const videoTabs = snapshot.videoTabs?.length ? snapshot.videoTabs : DEFAULT_VIDEO_TABS;
  const activeTab = settings.activeTab || snapshot.activeComposerTab || videoTabs[0];
  const engineValue = settings.engine || defaultEngineForKind(kind);
  const modeValue = settings.mode || defaultModeForKind(kind, activeTab);

  return (
    <form
      className="studio-composer node-floating-ui nodrag nowheel nopan origin-top transition-[transform,opacity] duration-150 ease-out"
      id="generationForm"
      data-composer-kind={kind}
      style={{ "--composer-scale": 1 / Math.max(0.2, Number(zoom || 1)) }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        updatePrompt(prompt, { commit: true });
        bridge.submitGeneration();
      }}
    >
      {kind === "video" ? (
        <div className="studio-composer-tabs" role="tablist">
          {videoTabs.map((tab) => (
            <button
              className={tab === activeTab ? "active" : ""}
              key={tab}
              type="button"
              onClick={() => {
                updateSetting("activeTab", tab);
                bridge.setComposerTab(tab, node.id);
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      ) : null}

      <div className="studio-reference-row">
        <div className="studio-reference-picker">
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setReferencePickerOpen((open) => !open);
            }}
          >
            <strong>+</strong>
            <span>参考</span>
          </button>
          {referencePickerOpen ? (
            <ReferenceMenu
              assets={referenceCandidatesForNode}
              emptyText="当前画板还没有可引用素材"
              onPick={queueReferencePick}
              onUpload={() => bridge.uploadNode(node.id)}
            />
          ) : null}
        </div>
        {references.map((asset) => (
          <button
            type="button"
            className="studio-reference-token-action"
            key={asset.id || asset.source || asset.title}
            draggable
            onDragStart={(event) => writeReferenceDragData(event, asset)}
            onClick={() => pickReference(asset)}
            title="插入到提示词"
          >
            <ReferenceToken asset={asset} />
          </button>
        ))}
      </div>

      <PromptEditor
        assets={snapshot.assets || []}
        prompt={prompt}
        references={references}
        queuedReference={queuedReference}
        onChange={(value) => updatePrompt(value)}
        onCommit={(value) => updatePrompt(value, { commit: true })}
        onPickReference={pickReference}
        onQueuedReferenceConsumed={() => setQueuedReference(null)}
        onUploadReference={() => bridge.uploadNode(node.id)}
      />

      <div className="studio-composer-footer jianying-toolbar">
        <EngineControl
          kind={kind}
          snapshot={snapshot}
          settings={settings}
          updateSetting={updateSetting}
        />
        <ParameterMenu
          kind={kind}
          snapshot={snapshot}
          settings={settings}
          updateSetting={updateSetting}
        />
        <SlashCommandButton
          onPick={(command) => updatePrompt(appendPromptText(prompt, command.insertText), { commit: true })}
        />
        <span className="studio-composer-spacer" />
        <button
          className="studio-text-tool"
          type="button"
          title="翻译 / 优化"
          onClick={() => bridge.handleComposerAction("translate")}
        >
          文A
        </button>
        <span className="studio-cost-pill">⚡{settings.cost || defaultCost(kind)}</span>
        <button
          className="studio-send-btn"
          id="submitGenerationBtn"
          type="submit"
          disabled={Boolean(node.activeGenerationJob)}
          title="生成"
        >
          ↑
        </button>
      </div>

      <input id="workflowMode" type="hidden" value={modeValue} readOnly />
      <input id="workflowEngine" type="hidden" value={engineValue} readOnly />
    </form>
  );
}

function PromptEditor({
  assets,
  prompt,
  references,
  queuedReference,
  onChange,
  onCommit,
  onPickReference,
  onQueuedReferenceConsumed,
  onUploadReference,
}) {
  const editorRef = useRef(null);
  const lastExternalPromptRef = useRef(prompt || "");
  const composingRef = useRef(false);
  const draggedMentionRef = useRef(null);
  const [mention, setMention] = useState({ open: false, query: "" });
  const allReferenceAssets = useMemo(
    () => mergeReferenceAssets(assets || [], references || []),
    [assets, references],
  );
  const mentionAssets = useMemo(
    () => referenceCandidates(assets || [], null, references, mention.query),
    [assets, mention.query, references],
  );

  useEffect(() => {
    if (!editorRef.current) return;
    const nextPrompt = prompt || "";
    if (lastExternalPromptRef.current === nextPrompt) return;
    lastExternalPromptRef.current = nextPrompt;
    if (document.activeElement === editorRef.current) return;
    renderPromptToEditor(editorRef.current, nextPrompt, allReferenceAssets);
  }, [allReferenceAssets, prompt]);

  useEffect(() => {
    if (!editorRef.current) return;
    renderPromptToEditor(editorRef.current, prompt || "", allReferenceAssets);
    lastExternalPromptRef.current = prompt || "";
  }, []);

  const syncMentionState = useCallback((value) => {
    const editor = editorRef.current;
    const caret = editor ? getCaretOffset(editor) : value.length;
    const fragment = mentionFragment(value, caret);
    setMention(fragment ? { open: true, query: fragment.query } : { open: false, query: "" });
  }, []);

  const pickAsset = useCallback(
    (asset) => {
      const editor = editorRef.current;
      if (!editor || !asset) return;
      const current = readPromptFromEditor(editor);
      const caret = getCaretOffset(editor);
      const fragment = mentionFragment(current, caret) || {
        end: caret,
        query: "",
        start: caret,
      };
      const inserted = mentionValueForAsset(asset);
      const suffix = current.slice(fragment.end);
      const spacer = suffix.startsWith(" ") || suffix.startsWith("\n") ? "" : " ";
      const next = `${current.slice(0, fragment.start)}${inserted}${spacer}${suffix}`;
      const scrollTop = editor.scrollTop;
      renderPromptToEditor(editor, next, mergeReferenceAssets(allReferenceAssets, [asset]));
      editor.focus({ preventScroll: true });
      setCaretOffset(editor, fragment.start + inserted.length + spacer.length);
      editor.scrollTop = scrollTop;
      lastExternalPromptRef.current = next;
      setMention({ open: false, query: "" });
      onChange(next);
      onPickReference?.(asset, next);
    },
    [allReferenceAssets, onChange, onPickReference],
  );

  useEffect(() => {
    if (!queuedReference?.asset) return;
    const editor = editorRef.current;
    if (editor) editor.focus({ preventScroll: true });
    pickAsset(queuedReference.asset);
    onQueuedReferenceConsumed?.();
  }, [onQueuedReferenceConsumed, pickAsset, queuedReference]);

  const syncEditorValue = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return "";
    const value = readPromptFromEditor(editor);
    lastExternalPromptRef.current = value;
    if (!composingRef.current) syncMentionState(value);
    onChange(value);
    return value;
  }, [onChange, syncMentionState]);

  const handleDrop = useCallback(
    (event) => {
      const editor = editorRef.current;
      if (!editor) return;
      const types = Array.from(event.dataTransfer?.types || []);
      if (!types.includes(REFERENCE_MIME) && !types.includes(MENTION_MIME)) return;
      event.preventDefault();
      event.stopPropagation();
      editor.focus({ preventScroll: true });
      setCaretFromPoint(editor, event.clientX, event.clientY);

      if (types.includes(MENTION_MIME)) {
        const dragged = draggedMentionRef.current;
        const selection = window.getSelection?.();
        if (!dragged || !editor.contains(dragged) || !selection || selection.rangeCount === 0) {
          return;
        }
        const range = selection.getRangeAt(0);
        try {
          if (range.intersectsNode(dragged)) return;
        } catch {}
        range.insertNode(dragged);
        range.setStartAfter(dragged);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        syncEditorValue();
        return;
      }

      const payload = parseReferenceDragData(event.dataTransfer.getData(REFERENCE_MIME));
      const asset =
        allReferenceAssets.find((item) => item.id === payload?.assetId) ||
        (assets || []).find((item) => item.id === payload?.assetId) ||
        payload;
      if (asset?.id) pickAsset(asset);
    },
    [allReferenceAssets, assets, pickAsset, syncEditorValue],
  );

  return (
    <div className="studio-prompt-box">
      <input id="promptInput" type="hidden" value={prompt} readOnly />
      <div
        id="promptInputRich"
        ref={editorRef}
        className="studio-prompt-editor"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder="描述你想要生成的画面内容，按 / 呼出指令，@引用素材"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          syncEditorValue();
        }}
        onDragStart={(event) => {
          const target = event.target.closest?.("[data-draggable-mention]");
          if (!target) return;
          draggedMentionRef.current = target;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(
            MENTION_MIME,
            JSON.stringify({
              assetId: target.dataset.mentionAssetId || "",
              value: target.dataset.mentionValue || target.textContent || "",
            }),
          );
        }}
        onDragEnd={() => {
          draggedMentionRef.current = null;
        }}
        onDragOver={(event) => {
          const types = Array.from(event.dataTransfer?.types || []);
          if (!types.includes(REFERENCE_MIME) && !types.includes(MENTION_MIME)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = types.includes(MENTION_MIME) ? "move" : "copy";
          setCaretFromPoint(event.currentTarget, event.clientX, event.clientY);
        }}
        onDrop={handleDrop}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (
            (event.key === "Backspace" || event.key === "Delete") &&
            removeAdjacentMention(event.currentTarget, event.key === "Backspace")
          ) {
            event.preventDefault();
            syncEditorValue();
            return;
          }
          if (!mention.open) return;
          if (event.key === "Escape") {
            event.preventDefault();
            setMention({ open: false, query: "" });
          }
          if (event.key === "Enter" && mentionAssets[0]) {
            event.preventDefault();
            pickAsset(mentionAssets[0]);
          }
        }}
        onInput={(event) => {
          const value = readPromptFromEditor(event.currentTarget);
          lastExternalPromptRef.current = value;
          if (!composingRef.current) syncMentionState(value);
          onChange(value);
        }}
        onBlur={(event) => onCommit?.(readPromptFromEditor(event.currentTarget))}
      />
      {mention.open ? (
        <ReferenceMenu
          assets={mentionAssets}
          emptyText="没有匹配的素材"
          query={mention.query}
          onPick={pickAsset}
          onUpload={onUploadReference}
        />
      ) : null}
    </div>
  );
}

function mergeReferenceAssets(...groups) {
  const merged = [];
  const seen = new Set();
  groups.flat().forEach((asset) => {
    if (!asset?.id || seen.has(asset.id)) return;
    seen.add(asset.id);
    merged.push(asset);
  });
  return merged;
}

function mentionValueForAsset(asset) {
  return `@${assetLabel(asset)}`;
}

function writeReferenceDragData(event, asset) {
  if (!event.dataTransfer || !asset?.id) return;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(
    REFERENCE_MIME,
    JSON.stringify({
      assetId: asset.id,
      label: assetLabel(asset),
      source: mediaSource(asset),
      title: asset.title || asset.displayName || asset.refName || asset.label || asset.id,
      type: asset.type || "image",
    }),
  );
}

function parseReferenceDragData(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return null;
  }
}

function renderPromptToEditor(editor, prompt, referenceAssets = []) {
  editor.replaceChildren();
  const text = String(prompt || "");
  if (!text) {
    editor.appendChild(document.createTextNode(""));
    return;
  }
  const mentions = referenceAssets
    .map((asset) => ({ asset, value: mentionValueForAsset(asset) }))
    .filter((item) => item.value.length > 1)
    .sort((a, b) => b.value.length - a.value.length);
  let index = 0;
  let buffer = "";
  const flush = () => {
    if (!buffer) return;
    appendPlainPromptText(editor, buffer);
    buffer = "";
  };
  while (index < text.length) {
    const match = mentions.find((item) => text.startsWith(item.value, index));
    if (match) {
      flush();
      editor.appendChild(createMentionElement(match.asset));
      index += match.value.length;
    } else {
      buffer += text[index];
      index += 1;
    }
  }
  flush();
}

function appendPlainPromptText(parent, text) {
  const parts = String(text).split("\n");
  parts.forEach((part, index) => {
    if (part) parent.appendChild(document.createTextNode(part));
    if (index < parts.length - 1) parent.appendChild(document.createElement("br"));
  });
}

function createMentionElement(asset) {
  const span = document.createElement("span");
  const value = mentionValueForAsset(asset);
  span.contentEditable = "false";
  span.draggable = true;
  span.dataset.draggableMention = "true";
  span.dataset.mentionAssetId = asset.id || "";
  span.dataset.mentionType = asset.type || "image";
  span.dataset.mentionValue = value;
  span.className = "mention-badge studio-mention-chip";

  const preview = document.createElement("span");
  preview.className = "studio-mention-preview";
  const source = mediaSource(asset);
  if (source && asset.type !== "audio") {
    const img = document.createElement("img");
    img.src = source;
    img.alt = "";
    img.draggable = false;
    preview.appendChild(img);
  } else {
    preview.textContent = asset.type === "video" ? "▶" : asset.type === "audio" ? "♪" : "◆";
  }
  span.appendChild(preview);

  const label = document.createElement("b");
  label.textContent = value;
  span.appendChild(label);
  return span;
}

function readPromptFromEditor(editor) {
  const parts = [];
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent || "");
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.mentionValue) {
      parts.push(node.dataset.mentionValue);
      return;
    }
    if (node.tagName === "BR") {
      parts.push("\n");
      return;
    }
    node.childNodes.forEach(walk);
  };
  editor.childNodes.forEach(walk);
  const value = parts.join("");
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

function setCaretFromPoint(editor, x, y) {
  const range = getRangeFromPoint(editor, x, y);
  if (!range) return false;
  const selection = window.getSelection?.();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function getRangeFromPoint(editor, x, y) {
  const doc = editor.ownerDocument;
  let range = null;
  if (doc.caretPositionFromPoint) {
    const position = doc.caretPositionFromPoint(x, y);
    if (position) {
      range = doc.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
    }
  } else if (doc.caretRangeFromPoint) {
    range = doc.caretRangeFromPoint(x, y);
  }
  if (!range || !editor.contains(range.startContainer)) {
    range = doc.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  return range;
}

function mentionFromNode(node) {
  return node instanceof HTMLElement && node.dataset.mentionValue ? node : null;
}

function removeAdjacentMention(editor, backward) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !editor.contains(range.startContainer)) return false;
  const container = range.startContainer;
  const offset = range.startOffset;
  let candidate = null;

  if (container.nodeType === Node.TEXT_NODE) {
    if (backward && offset === 0) candidate = container.previousSibling;
    if (!backward && offset === (container.textContent || "").length) {
      candidate = container.nextSibling;
    }
  } else if (container instanceof HTMLElement) {
    candidate = container.childNodes[backward ? offset - 1 : offset] || null;
  }

  const mention = mentionFromNode(candidate);
  if (!mention) return false;
  const nextRange = document.createRange();
  const parent = mention.parentNode;
  const index = Array.from(parent.childNodes).indexOf(mention);
  mention.remove();
  nextRange.setStart(parent, Math.max(0, index));
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
  return true;
}

function ReferenceMenu({ assets, emptyText, onPick, onUpload, query = "" }) {
  return (
    <div
      className="studio-reference-menu nodrag nopan nowheel"
      onPointerDown={(event) => {
        if (!event.target.closest?.("[data-reference-draggable]")) {
          event.preventDefault();
        }
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        if (!event.target.closest?.("[data-reference-draggable]")) {
          event.preventDefault();
        }
        event.stopPropagation();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <header>
        <span>{query ? `引用素材：${query}` : "引用素材"}</span>
        {onUpload ? (
          <button type="button" onClick={onUpload}>
            上传
          </button>
        ) : null}
      </header>
      {assets.length ? (
        <div className="studio-reference-menu-list">
          {assets.slice(0, 12).map((asset) => (
            <button
              type="button"
              key={asset.id || asset.source || asset.refName || asset.title}
              onClick={() => onPick(asset)}
            >
              <ReferenceToken asset={asset} compact />
              <small>{asset.type || "asset"}</small>
            </button>
          ))}
        </div>
      ) : (
        <div className="studio-reference-empty">
          <span>{emptyText || "暂无可引用素材"}</span>
          {onUpload ? (
            <button type="button" onClick={onUpload}>
              上传素材
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function appendPromptText(prompt, text) {
  const current = String(prompt || "").trimEnd();
  const next = String(text || "").trim();
  if (!next) return current;
  return current ? `${current}，${next}` : next;
}

function SlashCommandButton({ onPick }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="studio-slash-command-wrap nodrag nopan nowheel">
      <button
        type="button"
        className="studio-text-tool"
        title="提示词指令"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        /
      </button>
      {open ? (
        <div className="studio-slash-menu">
          <header>
            <span>指令</span>
            <em>点击写入提示词</em>
          </header>
          <div className="studio-slash-menu-list">
            {SLASH_COMMANDS.map((command) => (
              <button
                type="button"
                key={command.id}
                onClick={() => {
                  onPick(command);
                  setOpen(false);
                }}
              >
                <i>{command.icon}</i>
                <span>
                  <strong>{command.label}</strong>
                  <small>{command.insertText}</small>
                </span>
                <em>{command.category}</em>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EngineControl({ kind, snapshot, settings, updateSetting }) {
  if (kind === "image") {
    const models = snapshot.imageModels || [];
    const value = settings.imageModel || snapshot.selectedImageModelId || models[0]?.id || "";
    return (
      <label className="studio-native-select">
        <span>模型</span>
        <select
          id="imageModelSelect"
          value={value}
          onChange={(event) => updateSetting("imageModel", event.target.value)}
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label || model.name || model.id}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (kind === "video") {
    return (
      <label className="studio-native-select studio-toolbar-select">
        <span>模型</span>
        <select
          id="videoModelKey"
          value={settings.engine || JIANYING_VIDEO_MODEL_OPTIONS[0].value}
          onChange={(event) => updateSetting("engine", event.target.value)}
        >
          {JIANYING_VIDEO_MODEL_OPTIONS.map((model) => (
            <option key={model.value} value={model.value}>
              {model.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="studio-native-select">
      <span>{kind === "text" ? "文本" : "Seedance"}</span>
      <select
        value={settings.engine || defaultEngineForKind(kind)}
        onChange={(event) => updateSetting("engine", event.target.value)}
      >
        <option value={defaultEngineForKind(kind)}>
          {kind === "text" ? "Qwen / OpenAI 兼容" : "Seedance 2.0"}
        </option>
      </select>
    </label>
  );
}

function ParameterMenu({ kind, settings, updateSetting }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="studio-param-menu-wrap nodrag nopan nowheel"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="studio-param-trigger"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        参数
        <span>⌄</span>
      </button>
      {open ? (
        <div
          className="studio-param-menu jianying-param-menu"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          {kind === "image" ? (
            <>
              <NativeSelect
                id="imageModeType"
                label="模式"
                value={settings.imageModeType || "text2image"}
                options={IMAGE_MODE_TYPES}
                onChange={(value) => updateSetting("imageModeType", value)}
              />
              <NativeSelect
                id="imageSize"
                label="比例"
                value={settings.imageSize || "auto"}
                options={DEFAULT_IMAGE_SIZES}
                onChange={(value) => updateSetting("imageSize", value)}
              />
              <NativeSelect
                id="imageQuality"
                label="质量"
                value={settings.imageQuality || "auto"}
                options={["auto", "low", "medium", "high"]}
                onChange={(value) => updateSetting("imageQuality", value)}
              />
            </>
          ) : null}

          {kind === "video" ? (
            <>
              <NativeSelect
                id="videoModeType"
                label="模式"
                value={settings.videoModeType || "mixed2video"}
                options={VIDEO_MODE_TYPES}
                onChange={(value) => updateSetting("videoModeType", value)}
              />
              <NativeSelect
                id="videoAspectRatio"
                label="比例"
                value={settings.videoAspectRatio || "9:16"}
                options={DEFAULT_VIDEO_RATIOS}
                onChange={(value) => updateSetting("videoAspectRatio", value)}
              />
              <NativeSelect
                id="videoResolution"
                label="清晰度"
                value={settings.videoResolution || "720p"}
                options={DEFAULT_VIDEO_RESOLUTIONS}
                onChange={(value) => updateSetting("videoResolution", value)}
              />
              <NativeNumber
                id="videoDuration"
                label="时长"
                min={4}
                max={15}
                value={settings.videoDuration ?? 5}
                onChange={(value) => updateSetting("videoDuration", value)}
              />
              <NativeNumber
                id="videoCount"
                label="数量"
                min={1}
                max={4}
                value={settings.videoCount ?? 1}
                onChange={(value) => updateSetting("videoCount", value)}
              />
              <NativeSwitch
                id="videoReturnLastFrame"
                label="返回尾帧"
                checked={settings.videoReturnLastFrame ?? true}
                onChange={(value) => updateSetting("videoReturnLastFrame", value)}
              />
              <NativeSwitch
                id="videoGenerateAudio"
                label="生成音频"
                checked={settings.videoGenerateAudio ?? false}
                onChange={(value) => updateSetting("videoGenerateAudio", value)}
              />
              <NativeSwitch
                id="videoWatermark"
                label="水印"
                checked={settings.videoWatermark ?? false}
                onChange={(value) => updateSetting("videoWatermark", value)}
              />
              <NativeSwitch
                id="videoCameraFixed"
                label="固定镜头"
                checked={settings.videoCameraFixed ?? false}
                onChange={(value) => updateSetting("videoCameraFixed", value)}
              />
              <NativeSelect
                id="videoCameraMotion"
                label="运镜"
                value={settings.videoCameraMotion || ""}
                options={JIANYING_CAMERA_MOTIONS}
                onChange={(value) => updateSetting("videoCameraMotion", value)}
              />
              <StyleSnapshotPicker settings={settings} updateSetting={updateSetting} />
              <NativeSwitch
                id="videoDraft"
                label="草稿"
                checked={settings.videoDraft ?? false}
                onChange={(value) => updateSetting("videoDraft", value)}
              />
              <NativeSwitch
                id="videoWebSearch"
                label="联网搜索"
                checked={settings.videoWebSearch ?? false}
                onChange={(value) => updateSetting("videoWebSearch", value)}
              />
              <label className="studio-param-field full">
                <span>Seed</span>
                <input
                  id="videoSeed"
                  value={settings.videoSeed || ""}
                  onChange={(event) => updateSetting("videoSeed", event.target.value)}
                  placeholder="可选"
                />
              </label>
              <input id="videoDraftTaskId" type="hidden" value={settings.videoDraftTaskId || ""} readOnly />
              <input id="videoServiceTier" type="hidden" value={settings.videoServiceTier || ""} readOnly />
            </>
          ) : null}

          <label className="studio-param-field full">
            <span>参考强度</span>
            <input
              id="styleRange"
              type="range"
              min="0"
              max="100"
              value={settings.styleRange ?? 72}
              onChange={(event) => updateSetting("styleRange", event.target.value)}
            />
            <output id="styleValue">{settings.styleRange ?? 72}</output>
          </label>

          <HiddenFaceParams settings={settings} />
        </div>
      ) : null}
    </div>
  );
}

function StyleSnapshotPicker({ settings, updateSetting }) {
  const selectedId = settings.styleSnapshotId || JIANYING_STYLE_SNAPSHOTS[0]?.styleId || "";
  const selected =
    JIANYING_STYLE_SNAPSHOTS.find((style) => style.styleId === selectedId) ||
    JIANYING_STYLE_SNAPSHOTS[0];
  return (
    <section className="studio-param-section studio-style-section full">
      <strong>风格</strong>
      <div className="studio-style-grid">
        {JIANYING_STYLE_SNAPSHOTS.map((style) => (
          <button
            type="button"
            key={style.styleId}
            className={style.styleId === selectedId ? "active" : ""}
            onClick={() => {
              updateSetting("styleSnapshotId", style.styleId);
              updateSetting("styleSnapshot", style);
            }}
          >
            <span>{style.title}</span>
            <small>{style.category}</small>
          </button>
        ))}
      </div>
      <input id="videoStyleSnapshotId" type="hidden" value={selected?.styleId || ""} readOnly />
      <input id="videoStyleSnapshot" type="hidden" value={JSON.stringify(selected || {})} readOnly />
    </section>
  );
}

function NativeSelect({ id, label, value, options, onChange }) {
  return (
    <label className="studio-param-field">
      <span>{label}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => {
          const optionValue =
            typeof option === "object" && option !== null ? option.value : option;
          const optionLabel =
            typeof option === "object" && option !== null ? option.label : option;
          return (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
          );
        })}
      </select>
    </label>
  );
}

function NativeNumber({ id, label, value, min, max, onChange }) {
  return (
    <label className="studio-param-field">
      <span>{label}</span>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function NativeSwitch({ id, label, checked, onChange }) {
  return (
    <label className="studio-switch-field">
      <input
        id={id}
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function HiddenFaceParams({ settings }) {
  return (
    <>
      <input id="faceRestoreFidelity" type="hidden" value={settings.faceRestoreFidelity ?? 50} readOnly />
      <input id="faceRestoreScale" type="hidden" value={settings.faceRestoreScale ?? 125} readOnly />
      <input id="faceRestorePadding" type="hidden" value={settings.faceRestorePadding ?? 12} readOnly />
      <input id="faceSwapFeather" type="hidden" value={settings.faceSwapFeather ?? 22} readOnly />
      <input id="faceSwapColorMatch" type="hidden" value={settings.faceSwapColorMatch ?? 75} readOnly />
    </>
  );
}

function referenceCandidates(assets = [], node = null, references = [], query = "") {
  const excludedIds = new Set([
    node?.id,
    ...(references || []).map((asset) => asset?.id),
  ].filter(Boolean));
  const keyword = String(query || "").trim().toLowerCase();
  return (assets || [])
    .filter((asset) => asset?.id && !excludedIds.has(asset.id))
    .filter((asset) => ["image", "video", "audio"].includes(asset.type))
    .filter((asset) => {
      if (!keyword) return true;
      return assetSearchText(asset).includes(keyword);
    });
}

function assetLabel(asset) {
  return String(
    asset?.title ||
      asset?.displayName ||
      asset?.refName ||
      asset?.label ||
      asset?.originalName ||
      asset?.id ||
      "素材",
  ).trim();
}

function assetSearchText(asset) {
  return [
    asset?.title,
    asset?.displayName,
    asset?.refName,
    asset?.label,
    asset?.originalName,
    asset?.type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function appendMentionText(prompt, label) {
  const current = String(prompt || "").trimEnd();
  const mention = `@${label}`;
  if (!current) return `${mention} `;
  if (current.includes(mention)) return `${current} `;
  return `${current} ${mention} `;
}

function mentionFragment(value, caret) {
  const cursor = Math.max(0, Math.min(Number(caret || 0), value.length));
  const beforeCaret = value.slice(0, cursor);
  const start = beforeCaret.lastIndexOf("@");
  if (start < 0) return null;
  const query = beforeCaret.slice(start + 1);
  if (query.length > 48) return null;
  if (/[\s,，。；;：:、()[\]{}<>《》]/.test(query)) return null;
  return { end: cursor, query, start };
}

function getCaretOffset(element) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0) return element.textContent?.length || 0;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.endContainer)) return element.textContent?.length || 0;
  const preRange = range.cloneRange();
  preRange.selectNodeContents(element);
  preRange.setEnd(range.endContainer, range.endOffset);
  return preRange.toString().length;
}

function setCaretOffset(element, offset) {
  const targetOffset = Math.max(0, Number(offset || 0));
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let current = 0;
  let node = walker.nextNode();
  while (node) {
    const next = current + node.textContent.length;
    if (targetOffset <= next) {
      const range = document.createRange();
      range.setStart(node, targetOffset - current);
      range.collapse(true);
      const selection = window.getSelection?.();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    current = next;
    node = walker.nextNode();
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection?.();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    target.isContentEditable ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    Boolean(target.closest?.('[contenteditable="true"], input, textarea, select'))
  );
}

function isCanvasControlTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest?.(
      [
        ".studio-composer",
        ".studio-reference-menu",
        ".studio-param-menu",
        ".studio-workflow-menu",
        ".studio-sidebar",
        ".studio-history",
        ".studio-drawer",
        ".studio-node-actions",
        ".nodrag",
        ".nopan",
        ".nowheel",
        "button",
        "input",
        "select",
        "textarea",
        '[contenteditable="true"]',
      ].join(","),
    ),
  );
}

function ReferenceToken({ asset, compact = false }) {
  const src = mediaSource(asset);
  const label = assetLabel(asset);
  return (
    <span className={`studio-reference-token ${compact ? "compact" : ""}`}>
      {src && asset.type !== "audio" ? <img src={src} alt="" /> : <i>{asset.type === "video" ? "▶" : "◆"}</i>}
      <b>@{label}</b>
    </span>
  );
}

function StudioSidebar({ bridge }) {
  const [open, setOpen] = useState(false);
  const addType = useCallback(
    (type) => {
      bridge.addNode(type);
      setOpen(false);
    },
    [bridge],
  );

  return (
    <>
      {open ? (
        <div className="studio-quick-add-menu nodrag nopan nowheel">
          <button type="button" onClick={() => addType("text")}>
            文本
          </button>
          <button type="button" onClick={() => addType("image")}>
            图片
          </button>
          <button type="button" onClick={() => addType("video")}>
            视频
          </button>
          <button type="button" onClick={() => addType("audio")}>
            音频
          </button>
        </div>
      ) : null}
      <aside className="studio-sidebar" data-sidebar-container="true">
        <button
          type="button"
          className="primary"
          title="添加节点"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          +
        </button>
        <button type="button" title="画板" onClick={() => bridge.openDrawer("workflows")}>
          ▦
        </button>
        <button type="button" title="素材" onClick={() => bridge.openDrawer("assets")}>
          ◫
        </button>
        <button type="button" title="历史" onClick={() => bridge.toggleHistory()}>
          ◷
        </button>
        <span />
        <button type="button" title="帮助" onClick={() => bridge.toast("双击画布添加节点，拖拽端口连接节点。")}>
          ?
        </button>
      </aside>
    </>
  );
}

function HistoryPanel({ snapshot, bridge }) {
  if (!snapshot.historyOpen) return null;
  return (
    <aside className="studio-history">
      <header>
        <strong>生成历史</strong>
        <button type="button" onClick={() => bridge.toggleHistory()}>
          ×
        </button>
      </header>
      <div className="studio-history-list">
        {(snapshot.generationHistory || []).slice(0, 18).map((item, index) => (
          <button
            type="button"
            className="studio-history-item"
            key={item.id || item.taskId || index}
            onClick={() => bridge.addHistoryItem(item)}
          >
            {item.image || item.videoUrl ? (
              item.videoUrl ? (
                <video src={item.videoUrl} muted />
              ) : (
                <img src={item.image} alt="" />
              )
            ) : (
              <i>TXT</i>
            )}
            <span>{item.engine || item.modelName || item.mode || "生成结果"}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function StudioDrawer({ snapshot, bridge }) {
  if (!snapshot.drawer) return null;
  return (
    <aside className="studio-drawer">
      <header>
        <strong>{snapshot.drawer === "workflows" ? "画板" : snapshot.drawer === "assets" ? "素材" : "面板"}</strong>
        <button type="button" onClick={() => bridge.openDrawer("")}>
          ×
        </button>
      </header>
      {snapshot.drawer === "workflows" ? (
        <div className="studio-drawer-list">
          <button type="button" className="wide" onClick={() => bridge.createWorkflow()}>
            新建画板
          </button>
          {snapshot.workflows.map((workflow) => (
            <button
              type="button"
              key={workflow.id}
              className={workflow.id === snapshot.selectedWorkflowId ? "active" : ""}
              onClick={() => bridge.switchWorkflow(workflow.id)}
            >
              <strong>{workflow.title || "未命名画板"}</strong>
              <span>{workflow.nodeCount || 0} 节点</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="studio-drawer-list">
          {(snapshot.assets || []).map((asset) => (
            <button type="button" key={asset.id || asset.source} onClick={() => bridge.addAssetNode(asset)}>
              <ReferenceToken asset={asset} />
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

function referenceAssetsForNode(node, workflow) {
  if (!node?.id || !workflow?.links?.length) return [];
  const incomingIds = workflow.links
    .filter((link) => link.to === node.id)
    .map((link) => link.from);
  return (workflow.nodes || [])
    .filter((item) => incomingIds.includes(item.id))
    .filter((item) => ["image", "video", "audio"].includes(item.type))
    .map((item) => ({
      ...item,
      title: item.title || item.displayName || item.label || item.id,
      refName: item.title || item.displayName || item.label || item.id,
    }));
}

function mediaSource(node) {
  return node?.source || node?.videoUrl || node?.image || node?.audioUrl || "";
}

function composerKind(node) {
  if (node.type === "video") return "video";
  if (node.type === "image") return "image";
  if (node.type === "text" || node.type === "script") return "text";
  return "asset";
}

function nodeIcon(node) {
  if (node.type === "video") return "▶";
  if (node.type === "audio") return "♪";
  if (node.type === "script") return "▤";
  if (node.type === "text") return "T";
  return "▧";
}

function nodeMeta(node, references) {
  if (references?.length) return `${references.length} 引用`;
  if (node.type === "video") return "视频";
  if (node.type === "image") return "图片";
  if (node.type === "audio") return "音频";
  return node.label || "";
}

function defaultNodeWidth(node) {
  if (node.type === "video") return 520;
  if (node.type === "image") return 300;
  if (node.type === "audio") return 300;
  return 360;
}

function defaultEngineForKind(kind) {
  if (kind === "text") return "qwen3:14b";
  if (kind === "image") return "pollinations:flux";
  return JIANYING_VIDEO_MODEL_OPTIONS[0].value;
}

function defaultModeForKind(kind, activeTab) {
  if (kind === "text") return "text";
  if (kind === "image") return "image";
  if (kind === "video") {
    if (String(activeTab).includes("脸")) return "video-face-swap";
    return "video";
  }
  return kind;
}

function defaultCost(kind) {
  if (kind === "video") return 135;
  if (kind === "image") return 14;
  if (kind === "text") return 6;
  return 0;
}

globalThis.DreameStudioReact = {
  mount,
  unmount,
};
