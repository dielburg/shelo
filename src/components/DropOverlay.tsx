import { DropZone } from "../types";

const base: React.CSSProperties = {
  position: "absolute",
  background: "rgba(78, 205, 196, 0.12)",
  border: "2px solid rgba(78, 205, 196, 0.5)",
  borderRadius: 6,
  zIndex: 50,
  pointerEvents: "none",
  transition: "all 0.1s ease",
};

const styles: Record<DropZone, React.CSSProperties> = {
  left:   { ...base, left: 0, top: 0, width: "50%", height: "100%" },
  right:  { ...base, right: 0, top: 0, width: "50%", height: "100%" },
  top:    { ...base, left: 0, top: 0, width: "100%", height: "50%" },
  bottom: { ...base, left: 0, bottom: 0, width: "100%", height: "50%" },
};

export default function DropOverlay({ zone }: { zone: DropZone | null }) {
  if (!zone) return null;
  return <div style={styles[zone]} />;
}