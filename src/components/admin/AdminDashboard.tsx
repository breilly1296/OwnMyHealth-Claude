/**
 * Admin Dashboard Component
 *
 * Displays system statistics, recent activity, and quick actions for administrators.
 * Shows:
 * - User counts by role and status
 * - Data statistics (biomarkers, insurance plans, health needs)
 * - Recent login activity
 * - Quick action buttons
 */

import React, { useState, useEffect } from 'react';
import {
  Users,
  Activity,
  Shield,
  TrendingUp,
  AlertCircle,
  UserCheck,
  UserX,
  FileText,
  Heart,
  Clock,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { adminApi, type SystemStats } from '../../services/api';

interface AdminDashboardProps {
  onNavigateToUsers: () => void;
  onNavigateToAuditLogs: () => void;
}

interface StatCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  trend?: string;
  trendUp?: boolean;
  className?: string;
}

function StatCard({ title, value, icon, trend, trendUp, className = '' }: StatCardProps) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-6 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
          {trend && (
            <p className={`text-xs mt-1 ${trendUp ? 'text-green-600' : 'text-slate-500'}`}>
              {trend}
            </p>
          )}
        </div>
        <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center text-slate-600">
          {icon}
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboard({ onNavigateToUsers, onNavigateToAuditLogs }: AdminDashboardProps) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchStats = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminApi.getStats();
      setStats(data);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load statistics');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (isLoading && !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-red-700">{error}</p>
        <button
          onClick={fetchStats}
          className="mt-4 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
          <p className="text-slate-500 mt-1">System overview and management</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-500 flex items-center gap-1">
            <Clock className="w-4 h-4" />
            Last updated: {lastRefresh.toLocaleTimeString()}
          </span>
          <button
            onClick={fetchStats}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* User Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Users"
          value={stats?.users.total ?? 0}
          icon={<Users className="w-6 h-6" />}
        />
        <StatCard
          title="Active Users"
          value={stats?.users.active ?? 0}
          icon={<UserCheck className="w-6 h-6" />}
          trend={stats ? `${Math.round((stats.users.active / stats.users.total) * 100)}% of total` : undefined}
          trendUp
        />
        <StatCard
          title="Recent Logins (24h)"
          value={stats?.users.recentLogins ?? 0}
          icon={<Activity className="w-6 h-6" />}
        />
        <StatCard
          title="Inactive Users"
          value={(stats?.users.total ?? 0) - (stats?.users.active ?? 0)}
          icon={<UserX className="w-6 h-6" />}
        />
      </div>

      {/* Users by Role */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Users by Role</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Heart className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-blue-900">Patients</p>
                <p className="text-xl font-bold text-blue-700">{stats?.users.byRole?.PATIENT ?? 0}</p>
              </div>
            </div>
          </div>
          <div className="bg-green-50 rounded-lg p-4 border border-green-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <Activity className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-green-900">Providers</p>
                <p className="text-xl font-bold text-green-700">{stats?.users.byRole?.PROVIDER ?? 0}</p>
              </div>
            </div>
          </div>
          <div className="bg-purple-50 rounded-lg p-4 border border-purple-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <Shield className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-purple-900">Admins</p>
                <p className="text-xl font-bold text-purple-700">{stats?.users.byRole?.ADMIN ?? 0}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Data Statistics */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Data Statistics</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg">
            <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Total Biomarkers</p>
              <p className="text-xl font-bold text-slate-900">{stats?.data.biomarkers ?? 0}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg">
            <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center">
              <Shield className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Insurance Plans</p>
              <p className="text-xl font-bold text-slate-900">{stats?.data.insurancePlans ?? 0}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg">
            <div className="w-12 h-12 bg-rose-100 rounded-lg flex items-center justify-center">
              <Heart className="w-6 h-6 text-rose-600" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Health Needs</p>
              <p className="text-xl font-bold text-slate-900">{stats?.data.healthNeeds ?? 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <button
            onClick={onNavigateToUsers}
            className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors text-left"
          >
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="font-medium text-slate-900">Manage Users</p>
              <p className="text-sm text-slate-500">View and edit user accounts</p>
            </div>
          </button>
          <button
            onClick={onNavigateToAuditLogs}
            className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors text-left"
          >
            <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="font-medium text-slate-900">Audit Logs</p>
              <p className="text-sm text-slate-500">Review system activity</p>
            </div>
          </button>
          <button
            onClick={fetchStats}
            className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors text-left"
          >
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="font-medium text-slate-900">Refresh Stats</p>
              <p className="text-sm text-slate-500">Update dashboard data</p>
            </div>
          </button>
          <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg opacity-50">
            <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-slate-400" />
            </div>
            <div>
              <p className="font-medium text-slate-500">System Settings</p>
              <p className="text-sm text-slate-400">Coming soon</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
