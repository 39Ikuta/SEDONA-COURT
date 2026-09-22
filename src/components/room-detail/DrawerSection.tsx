import React from 'react';
import { ChevronDown } from 'lucide-react';

interface DrawerSectionProps {
  title: string;
  subtitle?: string;
  badge?: string | number;
  badgeTone?: 'neutral' | 'primary' | 'amber';
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const badgeStyles: Record<NonNullable<DrawerSectionProps['badgeTone']>, string> = {
  neutral: 'bg-cream text-charcoal/60 border border-secondary/50',
  primary: 'bg-primary text-white border border-primary',
  amber: 'bg-amber-100 text-amber-900 border border-amber-300',
};

/**
 * Collapsible section wrapper for the Frontdesk Drawer.
 * Content stays mounted when collapsed (display:none) so form state,
 * menu search, and fetched data are preserved across toggles.
 */
export const DrawerSection: React.FC<DrawerSectionProps> = ({
  title,
  subtitle,
  badge,
  badgeTone = 'neutral',
  open,
  onToggle,
  children,
}) => {
  return (
    <section className="border border-secondary/40 rounded-2xl overflow-hidden bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-cream/40 hover:bg-cream/70 transition cursor-pointer text-left"
      >
        <span className="min-w-0">
          <span className="block font-display font-bold text-xs text-primary uppercase tracking-wide">
            {title}
          </span>
          {subtitle && (
            <span className="block text-[10px] font-mono text-charcoal/50 truncate mt-0.5">
              {subtitle}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {badge !== undefined && (
            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${badgeStyles[badgeTone]}`}>
              {badge}
            </span>
          )}
          <ChevronDown
            size={15}
            className={`text-charcoal/50 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>
      <div className={open ? 'px-4 py-4 border-t border-secondary/30' : 'hidden'}>
        {children}
      </div>
    </section>
  );
};
