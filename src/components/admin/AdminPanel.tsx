/**
 * Admin Panel Component
 *
 * Main container for the admin interface. Provides navigation between:
 * - Admin Dashboard (overview and stats)
 * - User Management
 * - Audit Logs
 *
 * Only accessible to users with ADMIN role.
 */

import React, { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  FileText,
  ChevronLeft,
  Shield,
} from 'lucide-react';
import AdminDashboard from './AdminDashboard';
import UserManagementPanel from './UserManagementPanel';
import AuditLogViewer from './AuditLogViewer';

type AdminView = 'dashboard' | 'users' | 'audit-logs';

interface AdminPanelProps {
  onBack: () => void;
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}

function NavItem({ icon, label, isActive, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
        isActive
          ? 'bg-slate-900 text-white'
          : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {icon}
      <span className="font-medium">{label}</span>
    </button>
  );
}

export default function AdminPanel({ onBack }: AdminPanelProps) {
  const [currentView, setCurrentView] = useState<AdminView>('dashboard');

  const renderContent = () => {
    switch (currentView) {
      case 'dashboard':
        return (
          <AdminDashboard
            onNavigateToUsers={() => setCurrentView('users')}
            onNavigateToAuditLogs={() => setCurrentView('audit-logs')}
          />
        );
      case 'users':
        return (
          <UserManagementPanel
            onBack={() => setCurrentView('dashboard')}
          />
        );
      case 'audit-logs':
        return (
          <AuditLogViewer
            onBack={() => setCurrentView('dashboard')}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Bar */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={onBack}
                className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
                <span>Back to App</span>
              </button>
              <div className="h-6 w-px bg-slate-200" />
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                  <Shield className="w-4 h-4 text-purple-600" />
                </div>
                <span className="font-semibold text-slate-900">Admin Panel</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex gap-6">
          {/* Sidebar Navigation */}
          <div className="w-64 flex-shrink-0">
            <div className="bg-white rounded-xl border border-slate-200 p-3 sticky top-6">
              <nav className="space-y-1">
                <NavItem
                  icon={<LayoutDashboard className="w-5 h-5" />}
                  label="Dashboard"
                  isActive={currentView === 'dashboard'}
                  onClick={() => setCurrentView('dashboard')}
                />
                <NavItem
                  icon={<Users className="w-5 h-5" />}
                  label="User Management"
                  isActive={currentView === 'users'}
                  onClick={() => setCurrentView('users')}
                />
                <NavItem
                  icon={<FileText className="w-5 h-5" />}
                  label="Audit Logs"
                  isActive={currentView === 'audit-logs'}
                  onClick={() => setCurrentView('audit-logs')}
                />
              </nav>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 min-w-0">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
