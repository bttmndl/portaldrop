// The glowing portal ring. Children render inside the core (QR code while
// pairing, empty energy field once live). `flare` briefly supercharges the
// ring — used when an object arrives.
export default function Portal({ size = 340, flare = false, children }) {
  return (
    <div
      className={`portal${flare ? ' portal--flare' : ''}`}
      style={{ '--portal-size': `${size}px` }}
    >
      <div className="portal__glow" />
      <div className="portal__ring" />
      <div className="portal__core">{children}</div>
    </div>
  );
}
