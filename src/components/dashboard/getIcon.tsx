import React from 'react';
import {
  Activity,
  Droplets,
  Zap,
  Scale,
  Heart,
  HeartPulse,
  Droplet,
  // Note: Lucide doesn't have organ-specific icons, using visual approximations
  LucideKey as Kidney, // Key shape resembles kidney silhouette
  Clover as Liver, // Clover shape approximates liver lobes
  Flame,
  Zap as ZapIcon,
  BarChart3,
  Shield,
  BookOpen,
  Users,
  Database,
  Dna,
  LayoutDashboard,
  Sparkles,
  Bean,
  Pill,
  Bolt,
} from 'lucide-react';

/**
 * getIcon - Maps icon name strings to Lucide React icon components.
 *
 * Used to dynamically render icons in the sidebar based on category configuration.
 * Each icon is rendered at a consistent 5x5 (20px) size.
 *
 * @param iconName - The string name of the icon to retrieve
 * @returns A JSX element containing the requested icon, or Activity icon as fallback
 */
export function getIcon(iconName: string): JSX.Element {
  const icons: Record<string, JSX.Element> = {
    BarChart3: <BarChart3 className="w-5 h-5" />,
    Heart: <Heart className="w-5 h-5" />,
    HeartPulse: <HeartPulse className="w-5 h-5" />,
    Shield: <Shield className="w-5 h-5" />,
    BookOpen: <BookOpen className="w-5 h-5" />,
    Database: <Database className="w-5 h-5" />,
    Users: <Users className="w-5 h-5" />,
    Scale: <Scale className="w-5 h-5" />,
    Droplets: <Droplets className="w-5 h-5" />,
    Activity: <Activity className="w-5 h-5" />,
    Zap: <Zap className="w-5 h-5" />,
    Droplet: <Droplet className="w-5 h-5" />,
    Kidney: <Kidney className="w-5 h-5" />,
    Liver: <Liver className="w-5 h-5" />,
    Flame: <Flame className="w-5 h-5" />,
    ZapIcon: <ZapIcon className="w-5 h-5" />,
    Dna: <Dna className="w-5 h-5" />,
    LayoutDashboard: <LayoutDashboard className="w-5 h-5" />,
    Sparkles: <Sparkles className="w-5 h-5" />,
    Bean: <Bean className="w-5 h-5" />,
    Pill: <Pill className="w-5 h-5" />,
    Bolt: <Bolt className="w-5 h-5" />,
  };
  return icons[iconName] || <Activity className="w-5 h-5" />;
}
