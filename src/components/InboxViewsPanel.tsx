import React from 'react';
import {
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Facebook,
  Flame,
  Globe,
  Inbox,
  Instagram,
  Linkedin,
  Mail,
  MessageCircle,
  UserRoundX,
  Users,
  FolderOpen,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type InboxViewKey = 'ALL' | 'OPEN' | 'UNREAD' | 'UNASSIGNED' | 'HUMAN_HANDOFF' | 'AI_ACTIVE' | 'HIGH_INTENT' | 'RESOLVED';
type InboxChannelKey = 'ALL' | 'EMAIL' | 'WHATSAPP' | 'WEBSITE' | 'FACEBOOK' | 'INSTAGRAM' | 'LINKEDIN';

interface ViewCountMap {
  ALL: number;
  OPEN: number;
  UNREAD: number;
  UNASSIGNED: number;
  HUMAN_HANDOFF: number;
  AI_ACTIVE: number;
  HIGH_INTENT: number;
  RESOLVED: number;
}

interface ChannelCountMap {
  ALL: number;
  EMAIL: number;
  WHATSAPP: number;
  WEBSITE: number;
  FACEBOOK: number;
  INSTAGRAM: number;
  LINKEDIN: number;
}

interface InboxViewsPanelProps {
  collapsed: boolean;
  width: number;
  statusFilter: string;
  channelFilter: string;
  viewCounts: ViewCountMap;
  channelCounts: ChannelCountMap;
  onToggleCollapsed: () => void;
  onSelectView: (view: InboxViewKey) => void;
  onSelectChannel: (channel: InboxChannelKey) => void;
}

const views: Array<{ key: InboxViewKey; label: string; icon: LucideIcon }> = [
  { key: 'ALL', label: 'All conversations', icon: Inbox },
  { key: 'OPEN', label: 'Open', icon: FolderOpen },
  { key: 'UNREAD', label: 'Unread', icon: Mail },
  { key: 'UNASSIGNED', label: 'Unassigned', icon: UserRoundX },
  { key: 'HUMAN_HANDOFF', label: 'Human handoff', icon: Users },
  { key: 'AI_ACTIVE', label: 'AI active', icon: Bot },
  { key: 'HIGH_INTENT', label: 'High intent', icon: Flame },
  { key: 'RESOLVED', label: 'Resolved', icon: CheckCircle2 },
];

const channels: Array<{ key: InboxChannelKey; label: string; icon: LucideIcon }> = [
  { key: 'EMAIL', label: 'Email', icon: Mail },
  { key: 'WHATSAPP', label: 'WhatsApp', icon: MessageCircle },
  { key: 'WEBSITE', label: 'Website', icon: Globe },
  { key: 'FACEBOOK', label: 'Facebook', icon: Facebook },
  { key: 'INSTAGRAM', label: 'Instagram', icon: Instagram },
  { key: 'LINKEDIN', label: 'LinkedIn', icon: Linkedin },
];

export const InboxViewsPanel: React.FC<InboxViewsPanelProps> = ({
  collapsed,
  width,
  statusFilter,
  channelFilter,
  viewCounts,
  channelCounts,
  onToggleCollapsed,
  onSelectView,
  onSelectChannel,
}) => {
  return (
    <aside
      className={'uinbox-views-panel' + (collapsed ? ' is-collapsed' : '')}
      style={{ width, flexBasis: width }}
      aria-label="Inbox views and channels"
    >
      <div className="uinbox-views-header">
        {!collapsed && (
          <div className="min-w-0">
            <h2>Inbox</h2>
            <p>Customer conversations</p>
          </div>
        )}
        <span className="uinbox-views-total">{viewCounts.ALL}</span>
        <button
          type="button"
          className="uinbox-panel-collapse"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand inbox views' : 'Collapse inbox views'}
          title={collapsed ? 'Expand views' : 'Collapse views'}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>

      <div className="uinbox-views-scroll">
        {!collapsed && <p className="uinbox-section-label">Views</p>}
        <nav className="uinbox-view-list" aria-label="Conversation views">
          {views.map(({ key, label, icon: Icon }) => {
            const active = statusFilter === key;
            return (
              <button
                type="button"
                key={key}
                className={'uinbox-view-item' + (active ? ' is-active' : '')}
                onClick={() => onSelectView(key)}
                title={collapsed ? label + ' (' + viewCounts[key] + ')' : undefined}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={15} />
                {!collapsed && <span className="uinbox-view-label">{label}</span>}
                {!collapsed && <span className="uinbox-view-count">{viewCounts[key]}</span>}
              </button>
            );
          })}
        </nav>

        {!collapsed && <p className="uinbox-section-label uinbox-channel-heading">Channels</p>}
        <nav className="uinbox-channel-list" aria-label="Conversation channels">
          <button
            type="button"
            className={'uinbox-channel-item' + (channelFilter === 'ALL' ? ' is-active' : '')}
            onClick={() => onSelectChannel('ALL')}
            title={collapsed ? 'All channels (' + channelCounts.ALL + ')' : undefined}
          >
            <Inbox size={15} />
            {!collapsed && <span>All channels</span>}
            {!collapsed && <span className="uinbox-channel-count">{channelCounts.ALL}</span>}
          </button>
          {channels.map(({ key, label, icon: Icon }) => {
            const active = channelFilter === key;
            return (
              <button
                type="button"
                key={key}
                className={'uinbox-channel-item' + (active ? ' is-active' : '')}
                onClick={() => onSelectChannel(key)}
                title={collapsed ? label + ' (' + channelCounts[key] + ')' : undefined}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={15} />
                {!collapsed && <span>{label}</span>}
                {!collapsed && <span className="uinbox-channel-count">{channelCounts[key]}</span>}
              </button>
            );
          })}
        </nav>
      </div>


    </aside>
  );
};

export default InboxViewsPanel;
