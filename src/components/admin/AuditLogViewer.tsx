/**
 * Audit Log Viewer Component
 *
 * Displays system audit logs with filtering and pagination capabilities:
 * - Filter by user, action type, resource type, and date range
 * - Paginated log list
 * - Log detail modal with full information
 * - Export functionality (placeholder)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Calendar,
  User,
  Activity,
  Eye,
  Download,
  AlertCircle,
  Loader2,
  X,
  Clock,
  Globe,
  Monitor,
  Database,
} from 'lucide-react';
import { adminApi } from '../../services/api';
import Modal from '../common/Modal';

interface AuditLogViewerProps {
  onBack?: () => void;
}

interface AuditLog {
  id: string;
  userId: string | null;
  actorType: 'USER' | 'SYSTEM' | 'ANONYMOUS';
  action: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'EXPORT';
  resourceType: string;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: string | null;
  createdAt: string;
}

const ACTION_COLORS: Record<string, { bg: string; text: string }> = {
  CREATE: { bg: 'bg-green-100', text: 'text-green-700' },
  READ: { bg: 'bg-blue-100', text: 'text-blue-700' },
  UPDATE: { bg: 'bg-amber-100', text: 'text-amber-700' },
  DELETE: { bg: 'bg-red-100', text: 'text-red-700' },
  LOGIN: { bg: 'bg-purple-100', text: 'text-purple-700' },
  EXPORT: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
};

const RESOURCE_TYPES = [
  'Authentication',
  'Biomarker',
  'InsurancePlan',
  'HealthNeed',
  'DNAUpload',
  'User',
  'Session',
  'AuditLog',
];

const ACTIONS = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'EXPORT'];

function ActionBadge({ action }: { action: string }) {
  const colors = ACTION_COLORS[action] || { bg: 'bg-slate-100', text: 'text-slate-700' };
  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}>
      {action}
    </span>
  );
}

function ActorTypeBadge({ actorType }: { actorType: 'USER' | 'SYSTEM' | 'ANONYMOUS' }) {
  const config = {
    USER: { bg: 'bg-blue-50', text: 'text-blue-600', icon: User },
    SYSTEM: { bg: 'bg-slate-50', text: 'text-slate-600', icon: Monitor },
    ANONYMOUS: { bg: 'bg-amber-50', text: 'text-amber-600', icon: Globe },
  };

  const { bg, text, icon: Icon } = config[actorType] || config.ANONYMOUS;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${bg} ${text}`}>
      <Icon className="w-3 h-3" />
      {actorType}
    </span>
  );
}

export default function AuditLogViewer({ onBack }: AuditLogViewerProps) {
  // State
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [userIdFilter, setUserIdFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [resourceTypeFilter, setResourceTypeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Detail modal
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Fetch logs
  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await adminApi.getAuditLogs({
        page: pagination.page,
        limit: pagination.limit,
        userId: userIdFilter || undefined,
        action: actionFilter || undefined,
        resourceType: resourceTypeFilter || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setLogs(result.logs as AuditLog[]);
      setPagination(prev => ({ ...prev, ...result.pagination }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs');
    } finally {
      setIsLoading(false);
    }
  }, [pagination.page, pagination.limit, userIdFilter, actionFilter, resourceTypeFilter, startDate, endDate]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Handlers
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPagination(prev => ({ ...prev, page: 1 }));
    fetchLogs();
  };

  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  const handleViewDetails = (log: AuditLog) => {
    setSelectedLog(log);
    setShowDetailModal(true);
  };

  const clearFilters = () => {
    setUserIdFilter('');
    setActionFilter('');
    setResourceTypeFilter('');
    setStartDate('');
    setEndDate('');
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const hasActiveFilters = userIdFilter || actionFilter || resourceTypeFilter || startDate || endDate;

  const parseMetadata = (metadata: string | null): Record<string, unknown> | null => {
    if (!metadata) return null;
    try {
      return JSON.parse(metadata);
    } catch {
      return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {onBack && (
            <button
              onClick={onBack}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-slate-600" />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Audit Logs</h1>
            <p className="text-slate-500 mt-1">
              {pagination.total} log entries
            </p>
          </div>
        </div>
        <button
          disabled
          className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-slate-400 cursor-not-allowed"
          title="Export functionality coming soon"
        >
          <Download className="w-4 h-4" />
          Export
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                value={userIdFilter}
                onChange={(e) => setUserIdFilter(e.target.value)}
                placeholder="Search by user ID..."
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className={`px-4 py-2 border rounded-lg flex items-center gap-2 transition-colors ${
                showFilters || hasActiveFilters
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Filter className="w-4 h-4" />
              Filters
              {hasActiveFilters && (
                <span className="bg-brand-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                  {[userIdFilter, actionFilter, resourceTypeFilter, startDate, endDate].filter(Boolean).length}
                </span>
              )}
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              Search
            </button>
          </div>

          {showFilters && (
            <div className="pt-4 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Action</label>
                <select
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                >
                  <option value="">All Actions</option>
                  {ACTIONS.map(action => (
                    <option key={action} value={action}>{action}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Resource Type</label>
                <select
                  value={resourceTypeFilter}
                  onChange={(e) => setResourceTypeFilter(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                >
                  <option value="">All Types</option>
                  {RESOURCE_TYPES.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                />
              </div>
              {hasActiveFilters && (
                <div className="col-span-full">
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-sm text-slate-500 hover:text-slate-700 underline"
                  >
                    Clear all filters
                  </button>
                </div>
              )}
            </div>
          )}
        </form>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Logs Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500">No audit logs found</p>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="mt-2 text-brand-600 hover:text-brand-700 text-sm"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Timestamp
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Actor
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Action
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Resource
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    IP Address
                  </th>
                  <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="w-4 h-4 text-slate-400" />
                        <div>
                          <p className="text-slate-900">
                            {new Date(log.createdAt).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-slate-500">
                            {new Date(log.createdAt).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <ActorTypeBadge actorType={log.actorType} />
                        {log.userId && (
                          <p className="text-xs text-slate-500 font-mono truncate max-w-[120px]" title={log.userId}>
                            {log.userId.slice(0, 8)}...
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <ActionBadge action={log.action} />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Database className="w-4 h-4 text-slate-400" />
                        <div>
                          <p className="text-sm font-medium text-slate-900">{log.resourceType}</p>
                          {log.resourceId && (
                            <p className="text-xs text-slate-500 font-mono truncate max-w-[100px]" title={log.resourceId}>
                              {log.resourceId.slice(0, 8)}...
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {log.ipAddress || <span className="text-slate-400">N/A</span>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleViewDetails(log)}
                        className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500 hover:text-slate-700"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50">
            <p className="text-sm text-slate-600">
              Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} logs
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page === 1}
                className="p-2 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-3 py-1 text-sm text-slate-600">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page === pagination.totalPages}
                className="p-2 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Log Detail Modal */}
      <Modal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        title="Audit Log Details"
        subtitle={selectedLog ? `ID: ${selectedLog.id}` : undefined}
        size="lg"
      >
        {selectedLog && (
          <div className="p-6 space-y-6">
            {/* Overview */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-sm text-slate-500 mb-1">Timestamp</p>
                <p className="font-medium text-slate-900">
                  {new Date(selectedLog.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-sm text-slate-500 mb-1">Actor Type</p>
                <ActorTypeBadge actorType={selectedLog.actorType} />
              </div>
              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-sm text-slate-500 mb-1">Action</p>
                <ActionBadge action={selectedLog.action} />
              </div>
              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-sm text-slate-500 mb-1">Resource Type</p>
                <p className="font-medium text-slate-900">{selectedLog.resourceType}</p>
              </div>
            </div>

            {/* IDs */}
            <div className="space-y-3">
              {selectedLog.userId && (
                <div>
                  <p className="text-sm text-slate-500 mb-1">User ID</p>
                  <code className="block bg-slate-100 px-3 py-2 rounded text-sm font-mono text-slate-800 break-all">
                    {selectedLog.userId}
                  </code>
                </div>
              )}
              {selectedLog.resourceId && (
                <div>
                  <p className="text-sm text-slate-500 mb-1">Resource ID</p>
                  <code className="block bg-slate-100 px-3 py-2 rounded text-sm font-mono text-slate-800 break-all">
                    {selectedLog.resourceId}
                  </code>
                </div>
              )}
            </div>

            {/* Request Info */}
            <div className="space-y-3">
              <h3 className="font-medium text-slate-900">Request Information</h3>
              <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-slate-400" />
                  <span className="text-sm text-slate-600">IP Address:</span>
                  <span className="text-sm font-medium text-slate-900">
                    {selectedLog.ipAddress || 'N/A'}
                  </span>
                </div>
                {selectedLog.userAgent && (
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Monitor className="w-4 h-4 text-slate-400" />
                      <span className="text-sm text-slate-600">User Agent:</span>
                    </div>
                    <p className="text-xs text-slate-500 bg-white rounded p-2 break-all">
                      {selectedLog.userAgent}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Metadata */}
            {selectedLog.metadata && (
              <div className="space-y-3">
                <h3 className="font-medium text-slate-900">Metadata</h3>
                <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 overflow-auto text-xs">
                  {JSON.stringify(parseMetadata(selectedLog.metadata), null, 2)}
                </pre>
              </div>
            )}

            {/* Close Button */}
            <div className="flex justify-end pt-4 border-t border-slate-200">
              <button
                onClick={() => setShowDetailModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
