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
  ShieldAlert,
  BookOpen,
  Users,
  Database,
  Dna,
  LayoutDashboard,
  Sparkles,
  Bean,
  Pill,
  Bolt,
  // File icons
  FolderOpen,
  FileText,
  // Category icons
  Waves, // Thyroid
  Candy, // Diabetes
  CircleDot, // Iron Studies
  Bone, // Bone Health
  Timer, // Coagulation
  // New diagnostic category icons
  Target, // Tumor Markers
  Cherry, // Pancreatic
  TestTube, // Urinalysis
  Bug, // Infectious Disease
  Flower2, // Allergy
  Wind, // Blood Gas
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
    ShieldAlert: <ShieldAlert className="w-5 h-5" />,
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
    // Category icons
    Waves: <Waves className="w-5 h-5" />,
    Candy: <Candy className="w-5 h-5" />,
    CircleDot: <CircleDot className="w-5 h-5" />,
    Bone: <Bone className="w-5 h-5" />,
    Timer: <Timer className="w-5 h-5" />,
    // New diagnostic category icons
    Target: <Target className="w-5 h-5" />,
    Cherry: <Cherry className="w-5 h-5" />,
    TestTube: <TestTube className="w-5 h-5" />,
    Bug: <Bug className="w-5 h-5" />,
    Flower2: <Flower2 className="w-5 h-5" />,
    Wind: <Wind className="w-5 h-5" />,
    // File icons
    FolderOpen: <FolderOpen className="w-5 h-5" />,
    FileText: <FileText className="w-5 h-5" />,
  };
  return icons[iconName] || <Activity className="w-5 h-5" />;
}
