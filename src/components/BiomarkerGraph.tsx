import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import type { Biomarker } from '../types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface BiomarkerGraphProps {
  biomarker: Biomarker;
}

export default function BiomarkerGraph({ biomarker }: BiomarkerGraphProps) {
  if (!biomarker.history || biomarker.history.length === 0) return null;

  const options = {
    responsive: true,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context: any) => `${context.parsed.y} ${biomarker.unit}`,
        },
      },
    },
    scales: {
      y: {
        min: Math.min(biomarker.normalRange.min * 0.8, ...biomarker.history.map(h => h.value)),
        max: Math.max(biomarker.normalRange.max * 1.2, ...biomarker.history.map(h => h.value)),
        ticks: {
          callback: (value: number) => `${value} ${biomarker.unit}`,
        },
      },
    },
  };

  const data = {
    labels: biomarker.history.map(h => new Date(h.date).toLocaleDateString()),
    datasets: [
      {
        label: biomarker.name,
        data: biomarker.history.map(h => h.value),
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.5)',
        tension: 0.3,
      },
      {
        label: 'Min Range',
        data: biomarker.history.map(() => biomarker.normalRange.min),
        borderColor: 'rgba(220, 38, 38, 0.5)',
        borderDash: [5, 5],
        pointRadius: 0,
      },
      {
        label: 'Max Range',
        data: biomarker.history.map(() => biomarker.normalRange.max),
        borderColor: 'rgba(220, 38, 38, 0.5)',
        borderDash: [5, 5],
        pointRadius: 0,
      },
    ],
  };

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h3 className="text-lg font-semibold mb-4">{biomarker.name} History</h3>
      <Line options={options} data={data} />
    </div>
  );
}