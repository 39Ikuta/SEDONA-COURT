import React from 'react';
import { encodeCode128B, formatGatePassDateTime } from '../utils/barcode';

export interface GatePassData {
  ticketNo: string;
  roomNumber: string | number;
  roomType?: string;
  guestName?: string;
  checkIn: string | Date;
  checkOut: string | Date;
  cashierName?: string;
  plateNumber?: string;
  issuedAt?: string | Date;
}

interface PrintableGatePassProps {
  data: GatePassData;
  className?: string;
  hideTearEffect?: boolean;
}

export const PrintableGatePass: React.FC<PrintableGatePassProps> = ({
  data,
  className = '',
  hideTearEffect = false,
}) => {
  const {
    ticketNo,
    roomNumber,
    roomType,
    guestName,
    checkIn,
    checkOut,
    cashierName = 'Frontdesk',
    plateNumber,
  } = data;

  const formattedCheckIn = formatGatePassDateTime(checkIn);
  const formattedCheckOut = formatGatePassDateTime(checkOut);

  // Generate crisp Code 128 barcode bits
  const barcodeBits = encodeCode128B(ticketNo || `GP-${roomNumber}`);
  const totalModules = barcodeBits.length || 1;

  return (
    <div
      id="printable-gate-pass"
      className={`w-[80mm] max-w-[80mm] min-w-[80mm] bg-white border border-secondary shadow-lg p-5 relative overflow-hidden flex-shrink-0 text-black font-mono select-text print:border-none print:shadow-none print:text-black ${className}`}
      style={{
        backgroundImage: 'radial-gradient(ellipse at top, #ebd5c61a 0%, transparent 80%)',
      }}
    >
      {/* Serrated Cut/Tear Effect Top */}
      {!hideTearEffect && (
        <div className="absolute top-0 left-0 right-0 h-1 flex justify-between overflow-hidden opacity-50 select-none pointer-events-none print:hidden">
          {Array.from({ length: 40 }).map((_, i) => (
            <div
              key={i}
              className="w-2.5 h-2.5 bg-cream rotate-45 flex-shrink-0 -translate-y-1.5 border-b border-r border-secondary"
            />
          ))}
        </div>
      )}

      {/* Main Gate Pass Body */}
      <div className="text-[11px] text-black pt-3 pb-2 space-y-3.5">
        {/* Header Brand */}
        <div className="text-center space-y-1">
          <h3 className="font-display font-extrabold text-sm tracking-tight text-black leading-none uppercase">
            Sedona Court
          </h3>
          <p className="text-[9px] text-black leading-relaxed uppercase">
            Doña Remedios Trinidad Hwy,<br />
            San Rafael, 3008 Bulacan<br />
            TEL: +63 (0939) 905-2816
          </p>
        </div>

        {/* Double Line Divider */}
        <div className="border-t-2 border-solid border-black my-2 print:border-black" />

        {/* Prominent GATE PASS Title Banner */}
        <div className="text-center py-1 bg-black text-white rounded-xs">
          <h2 className="font-extrabold text-sm tracking-widest uppercase font-mono">
            GATE PASS
          </h2>
        </div>

        {/* Required Primary Metadata */}
        <div className="space-y-1.5 text-[11px] uppercase text-black pt-1">
          <div className="flex justify-between items-baseline font-bold">
            <span className="text-[10px]">Ticket No.:</span>
            <span className="font-extrabold text-xs tracking-wider">{ticketNo}</span>
          </div>
          <div className="flex justify-between items-baseline font-bold">
            <span className="text-[10px]">Room No.:</span>
            <span className="font-extrabold text-sm">{roomNumber}{roomType ? ` (${roomType})` : ''}</span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-[10px] font-bold">Check In Date &amp; Time:</span>
            <span className="font-medium text-[10px]">{formattedCheckIn}</span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-[10px] font-bold">Check Out Date &amp; Time:</span>
            <span className="font-medium text-[10px]">{formattedCheckOut}</span>
          </div>
        </div>

        {/* Dashed Separator */}
        <div className="border-t border-dashed border-black my-2 print:border-black" />

        {/* Secondary Stay Details */}
        <div className="space-y-1 text-[10px] uppercase text-black">
          {guestName && (
            <div className="flex justify-between items-start">
              <span className="shrink-0 pr-2">Guest:</span>
              <span className="font-bold break-all text-right flex-1">{guestName}</span>
            </div>
          )}
          {plateNumber && (
            <div className="flex justify-between items-start">
              <span className="shrink-0 pr-2">Plate / Vehicle:</span>
              <span className="font-bold text-right flex-1">{plateNumber}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>Cashier Operator:</span>
            <span className="font-bold">{cashierName} // FD-01</span>
          </div>
          <div className="flex justify-between">
            <span>Pass Status:</span>
            <span className="font-bold uppercase tracking-wider">CLEARED FOR EXIT</span>
          </div>
        </div>

        {/* Dashed Separator */}
        <div className="border-t border-dashed border-black my-2 print:border-black" />

        {/* High-Precision Thermal Scannable Barcode */}
        <div className="text-center space-y-2 pt-1 text-black">
          <div className="flex flex-col items-center gap-1">
            <svg
              className="w-52 h-10"
              viewBox={`0 0 ${totalModules} 32`}
              preserveAspectRatio="none"
              shapeRendering="crispEdges"
            >
              {barcodeBits.split('').map((bit, idx) => (
                bit === '1' ? (
                  <rect
                    key={idx}
                    x={idx}
                    y={0}
                    width={1}
                    height={32}
                    fill="#000000"
                  />
                ) : null
              ))}
            </svg>
            <span className="text-[10px] tracking-[0.25em] font-mono font-bold">
              *{ticketNo}*
            </span>
          </div>
        </div>
      </div>

      {/* Serrated Cut/Tear Effect Bottom */}
      {!hideTearEffect && (
        <div className="absolute bottom-0 left-0 right-0 h-1 flex justify-between overflow-hidden opacity-50 select-none pointer-events-none print:hidden">
          {Array.from({ length: 40 }).map((_, i) => (
            <div
              key={i}
              className="w-2.5 h-2.5 bg-cream rotate-45 flex-shrink-0 translate-y-1.5 border-t border-l border-secondary"
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default PrintableGatePass;
