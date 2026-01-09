/**
 * Admin API
 */

import { apiFetch } from './client';
import { UserRole } from './provider';

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  _count?: {
    biomarkers: number;
    insurancePlans: number;
    healthNeeds: number;
  };
}

export interface SystemStats {
  users: {
    total: number;
    active: number;
    byRole: Record<string, number>;
    recentLogins: number;
  };
  data: {
    biomarkers: number;
    insurancePlans: number;
    healthNeeds: number;
  };
}

export const adminApi = {
  async getUsers(params?: {
    page?: number;
    limit?: number;
    role?: UserRole;
    isActive?: boolean;
    search?: string;
  }): Promise<{ users: AdminUser[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.role) searchParams.set('role', params.role);
    if (params?.isActive !== undefined) searchParams.set('isActive', params.isActive.toString());
    if (params?.search) searchParams.set('search', params.search);

    const query = searchParams.toString();
    const response = await apiFetch<{ users: AdminUser[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(`/admin/users${query ? `?${query}` : ''}`);
    return response.data;
  },

  async getUser(id: string): Promise<AdminUser> {
    const response = await apiFetch<AdminUser>(`/admin/users/${id}`);
    return response.data;
  },

  async createUser(data: {
    email: string;
    password: string;
    role?: UserRole;
    isActive?: boolean;
    emailVerified?: boolean;
  }): Promise<AdminUser> {
    const response = await apiFetch<AdminUser>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async updateUser(
    id: string,
    data: {
      role?: UserRole;
      isActive?: boolean;
      emailVerified?: boolean;
      password?: string;
    }
  ): Promise<AdminUser> {
    const response = await apiFetch<AdminUser>(`/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async deactivateUser(id: string): Promise<{ message: string }> {
    const response = await apiFetch<{ message: string }>(`/admin/users/${id}`, {
      method: 'DELETE',
    });
    return response.data;
  },

  async deleteUserPermanently(id: string, confirmEmail: string): Promise<{ message: string }> {
    const response = await apiFetch<{ message: string }>(`/admin/users/${id}/permanent`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmEmail }),
    });
    return response.data;
  },

  async getStats(): Promise<SystemStats> {
    const response = await apiFetch<SystemStats>('/admin/stats');
    return response.data;
  },

  async getAuditLogs(params?: {
    page?: number;
    limit?: number;
    userId?: string;
    action?: string;
    resourceType?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{ logs: unknown[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.userId) searchParams.set('userId', params.userId);
    if (params?.action) searchParams.set('action', params.action);
    if (params?.resourceType) searchParams.set('resourceType', params.resourceType);
    if (params?.startDate) searchParams.set('startDate', params.startDate);
    if (params?.endDate) searchParams.set('endDate', params.endDate);

    const query = searchParams.toString();
    const response = await apiFetch<{ logs: unknown[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(`/admin/audit-logs${query ? `?${query}` : ''}`);
    return response.data;
  },
};
