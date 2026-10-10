"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  href?: string;
  alert?: boolean;
}

export function KPICard({ title, value, subtitle, icon, href, alert }: KPICardProps) {
  const content = (
    <div
      className={`p-5 rounded-2xl bg-white border ${
        alert ? "border-amber-200 bg-amber-50/20" : "border-slate-200/90"
      } shadow-sm transition-all duration-200 ${
        href ? "hover:shadow-md hover:border-purple-200 group cursor-pointer" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</span>
        {icon && (
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
              alert ? "bg-amber-100 text-amber-700" : "bg-purple-50 text-purple-700"
            }`}
          >
            {icon}
          </div>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xl font-bold tracking-tight text-slate-900">{value}</span>
        {href && (
          <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-purple-600 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
        )}
      </div>

      {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}
