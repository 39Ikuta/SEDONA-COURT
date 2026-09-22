import React from 'react';
import { KitchenOrder } from '../api/kitchen';

interface PrintableKitchenTicketProps {
  order?: KitchenOrder | null;
  orders?: KitchenOrder[];
  className?: string;
  hideTearEffect?: boolean;
}

export const PrintableKitchenTicket: React.FC<PrintableKitchenTicketProps> = ({
  order,
  orders,
  className = '',
  hideTearEffect = false,
}) => {
  const ticketList = orders && orders.length > 0 ? orders : (order ? [order] : []);

  if (ticketList.length === 0) return null;

  const formatDisplayDate = (val?: string) => {
    if (!val) return new Date().toLocaleString();
    const d = new Date(val.includes(' ') && !val.includes('T') ? val.replace(' ', 'T') : val);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    }
    return val;
  };

  // Aggregate metadata
  // Sort chronologically for range display (oldest to newest)
  const sortedTickets = [...ticketList].sort((a, b) => {
    return new Date(a.ordered_at).getTime() - new Date(b.ordered_at).getTime();
  });
  
  const firstTicket = sortedTickets[0];
  const lastTicket = sortedTickets[sortedTickets.length - 1];

  let displayOrderNumber = firstTicket.order_number;
  const uniqueOrders = Array.from(new Set(sortedTickets.map(t => t.order_number)));
  if (uniqueOrders.length > 1) {
    if (uniqueOrders.length === 2) {
      displayOrderNumber = `${uniqueOrders[0]} & ${uniqueOrders[1]}`;
    } else {
      displayOrderNumber = `${uniqueOrders[0]} TO ${uniqueOrders[uniqueOrders.length - 1]}`;
    }
  }

  // Aggregate items
  const allItems = sortedTickets.flatMap(t => 
    t.items.map(it => ({
      ...it,
      parentOrder: t.order_number,
      parentStatus: t.status
    }))
  );

  const totalAmount = sortedTickets.reduce((sum, t) => sum + (t.total_amount || 0), 0);
  
  const combinedSpecialInstructions = sortedTickets
    .filter(t => t.special_instructions?.trim())
    .map(t => `${t.order_number}: ${t.special_instructions}`)
    .join(' | ');

  const hasUrgent = sortedTickets.some(t => t.priority === 'urgent');

  return (
    <div
      id="printable-kitchen-ticket"
      className={`w-[80mm] max-w-[80mm] min-w-[80mm] bg-white border border-secondary shadow-lg p-5 relative overflow-hidden flex-shrink-0 text-black font-mono select-text ${className}`}
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

      <div className="text-[11px] pt-3 pb-2 space-y-4">
        <div>
          {/* Header Brand matching 80mm Receipt */}
          <div className="text-center space-y-1.5">
            <h3 className="font-display font-extrabold text-sm tracking-tight text-primary print:text-black uppercase leading-none">
              Sedona Court
            </h3>
            <p className="text-[9px] text-charcoal/60 print:text-black leading-relaxed uppercase">
              Doña Remedios Trinidad Hwy,<br />
              San Rafael, 3008 Bulacan<br />
              {uniqueOrders.length > 1 ? 'BATCH KITCHEN ORDERS' : 'KITCHEN ORDER TICKET'} • 80MM ROLL
            </p>
          </div>

          {/* Separator */}
          <div className="border-t border-dashed border-charcoal/20 my-2.5 print:border-black" />

          {/* Metadata Panel */}
          <div className="space-y-1 text-[10px] uppercase">
            <div className="flex justify-between font-bold">
              <span>ORDER TICKET NO:</span>
              <span className="font-extrabold text-primary print:text-black text-right pl-2">{displayOrderNumber}</span>
            </div>
            <div className="flex justify-between font-bold text-primary print:text-black">
              <span>ROOM NUMBER:</span>
              <span>ROOM {lastTicket.room_number}</span>
            </div>
            <div className="flex justify-between items-start">
              <span className="shrink-0 pr-1">GUEST:</span>
              <span className="font-bold break-all text-right flex-1">{lastTicket.guest_name}</span>
            </div>
            <div className="flex justify-between">
              <span>ORDERED AT:</span>
              <span className="text-right pl-2">{uniqueOrders.length > 1 ? `${formatDisplayDate(firstTicket.ordered_at)} - ${formatDisplayDate(lastTicket.ordered_at)}` : formatDisplayDate(lastTicket.ordered_at)}</span>
            </div>
            <div className="flex justify-between">
              <span>OPERATOR / CASHIER:</span>
              <span className="font-bold text-right pl-2">{lastTicket.cashier_name || 'Frontdesk'} // FD-01</span>
            </div>
            {lastTicket.receipt_no && (
              <div className="flex justify-between text-charcoal/70 print:text-black">
                <span>BILL RECEIPT REF:</span>
                <span className="font-bold text-right pl-2">{lastTicket.receipt_no}</span>
              </div>
            )}
            {hasUrgent && (
              <div className="text-center font-extrabold text-xs py-1 bg-black text-white my-1 tracking-wider uppercase">
                *** URGENT KITCHEN ORDER ***
              </div>
            )}
          </div>

          {/* Separator */}
          <div className="border-t border-dashed border-charcoal/20 my-2.5 print:border-black" />

          {/* Items List */}
          <div className="space-y-2.5">
            <div className="flex justify-between font-bold text-[10px] text-charcoal/50 print:text-black uppercase">
              <span>QTY &amp; ITEM DESCRIPTION</span>
              <span>STATUS</span>
            </div>
            <div className="space-y-2">
              {allItems.map((it, itIdx) => (
                <div key={itIdx} className="space-y-0.5">
                  <div className="flex justify-between items-start text-xs font-bold">
                    <span className="flex-1 pr-2 break-words leading-tight">
                      {it.quantity}x {it.name}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase text-charcoal/70 print:text-black font-semibold">
                      {it.parentStatus}
                    </span>
                  </div>
                  {uniqueOrders.length > 1 && (
                    <div className="text-[9px] text-charcoal/50 print:text-black font-semibold ml-4">
                      (From {it.parentOrder})
                    </div>
                  )}
                  {it.special_instructions && (
                    <div className="text-[10px] text-amber-900 print:text-black italic pl-3 border-l-2 border-amber-300 print:border-black ml-1 mt-0.5">
                      ↳ Note: {it.special_instructions}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Special Order Notes */}
          {combinedSpecialInstructions && (
            <div className="mt-2.5 p-2 bg-cream/40 print:bg-transparent border border-dashed border-charcoal/30 print:border-black text-[10px] space-y-0.5">
              <span className="font-bold block uppercase text-primary print:text-black">SPECIAL INSTRUCTIONS:</span>
              <p className="text-charcoal/80 print:text-black italic">{combinedSpecialInstructions}</p>
            </div>
          )}

          {/* Separator */}
          <div className="border-t border-dashed border-charcoal/20 my-2.5 print:border-black" />

          {/* Totals */}
          <div className="flex justify-between text-xs font-extrabold uppercase text-primary print:text-black">
            <span>ORDER TOTAL:</span>
            <span>₱{totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>

          {/* Separator */}
          <div className="border-t-2 border-double border-charcoal/30 my-2.5 print:border-black" />

          {/* Barcode & Footer matching 80mm receipt */}
          <div className="text-center space-y-2.5 pt-1">
            <div className="flex flex-col items-center gap-1">
              <svg className="w-44 h-7 opacity-80" viewBox="0 0 100 20" preserveAspectRatio="none">
                {Array.from({ length: 42 }).map((_, i) => {
                  const width = (i % 3 === 0) ? '2' : (i % 2 === 0) ? '1' : '0.5';
                  const x = i * 2.3;
                  return (
                    <rect
                      key={i}
                      x={x}
                      y="0"
                      width={width}
                      height="20"
                      fill="#221c1d"
                    />
                  );
                })}
              </svg>
              <span className="text-[9px] tracking-[0.25em] font-mono text-charcoal/50 print:text-black">
                *{displayOrderNumber}*
              </span>
            </div>

            <div className="space-y-0.5 text-[9px] uppercase font-bold text-charcoal/60 print:text-black">
              <p>*** KITCHEN DISPATCH COPY ***</p>
              <p className="text-[8px] font-normal italic lowercase">please prepare with care • sedona court</p>
            </div>
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

export default PrintableKitchenTicket;
