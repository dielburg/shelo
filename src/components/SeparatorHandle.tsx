import { SeparatorInfo } from "../layoutTree";
import { SeparatorDragAPI } from "../hooks/useSeparatorDrag";

interface Props {
  sep: SeparatorInfo;
  sepDrag: SeparatorDragAPI;
}

const HIT_SIZE = 6;

export default function SeparatorHandle({ sep, sepDrag }: Props) {
  const isH = sep.direction === "horizontal";
  const isActive = sepDrag.activePath?.join() === sep.path.join();

  return (
    <div
      onMouseDown={e => sepDrag.onMouseDown(e, sep)}
      onDoubleClick={() => sepDrag.onDoubleClick(sep)}
      style={{
        position: "absolute",
        left: isH ? `calc(${sep.x * 100}% - ${HIT_SIZE / 2}px)` : `${sep.x * 100}%`,
        top: isH ? `${sep.y * 100}%` : `calc(${sep.y * 100}% - ${HIT_SIZE / 2}px)`,
        width: isH ? HIT_SIZE : `${sep.w * 100}%`,
        height: isH ? `${sep.h * 100}%` : HIT_SIZE,
        cursor: isH ? "col-resize" : "row-resize",
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{
        width: isH ? 1 : "100%",
        height: isH ? "100%" : 1,
        background: isActive ? "#4ecdc4" : "#161925",
        transition: sepDrag.isDragging ? "none" : "background 0.15s",
      }} />
    </div>
  );
}