import { useMemo } from 'react'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { SEV_COLOR, SEV_LABEL, fmtVal, type Severity, type Unit } from '../lib/alerts'

const FONT = "'Inter Variable', Inter, system-ui, sans-serif"

export interface AlertSeries {
  name: string
  color: string
  data: [number, number | null][]
}

interface Props {
  series: AlertSeries[]
  lines: { severity: Severity; value: number; label?: string; color?: string }[]
  unit: Unit
  latencyUnit?: 's' | 'ms'
  bands?: { from: number; to: number; severity: Severity }[]
  height?: number
}

const BAND: Record<Severity, string> = { critical: 'rgba(196,48,43,0.08)', warning: 'rgba(201,138,0,0.10)', info: 'rgba(42,120,214,0.08)' }

/** Metric over time with one dashed line per threshold and shaded trigger periods. */
export function AlertChart({ series, lines, unit, latencyUnit = 's', bands = [], height = 230 }: Props) {
  const options = useMemo<Highcharts.Options>(() => {
    const vals = series.flatMap((s) => s.data.map((d) => d[1]).filter((v): v is number => v !== null))
    const hi = Math.max(...vals, ...lines.map((l) => l.value), 0)
    const lo = Math.min(...vals, ...lines.map((l) => l.value))
    const multi = series.length > 1
    const fmt = (v: number) => fmtVal(v, unit, latencyUnit)
    return {
      chart: { type: 'line', height, backgroundColor: 'transparent', style: { fontFamily: FONT }, spacing: [10, 4, 6, 4], animation: false, zooming: { type: 'x' } },
      title: { text: undefined },
      credits: { enabled: false },
      accessibility: { enabled: false },
      time: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      legend: { enabled: multi, align: 'left', verticalAlign: 'top', margin: 10, padding: 0, symbolRadius: 2, symbolHeight: 9, symbolWidth: 9, itemStyle: { color: '#4d4d4a', fontWeight: '400', fontSize: '12px' } },
      xAxis: {
        type: 'datetime',
        lineColor: '#d6d6d2',
        tickLength: 0,
        crosshair: { color: '#d6d6d2', width: 1 },
        labels: { style: { color: '#8a8a85', fontSize: '11px' } },
        plotBands: bands.map((b) => ({ from: b.from, to: b.to, color: BAND[b.severity], zIndex: 0 })),
      },
      yAxis: {
        title: { text: undefined },
        gridLineColor: '#ededea',
        min: unit === 'conf' ? Math.max(0, Math.floor((lo - 0.05) * 10) / 10) : 0,
        max: unit === 'conf' ? 1 : hi * 1.15 || 1,
        allowDecimals: unit !== 'count',
        plotLines: lines.map((l) => ({
          value: l.value,
          color: l.color ?? SEV_COLOR[l.severity],
          width: 1,
          dashStyle: 'Dash' as const,
          zIndex: 3,
          label: { text: l.label ?? `${SEV_LABEL[l.severity]} ${fmt(l.value)}`, align: 'right' as const, x: -4, y: -5, style: { color: l.color ?? SEV_COLOR[l.severity], fontSize: '11px', fontWeight: '500' } },
        })),
        labels: { style: { color: '#8a8a85', fontSize: '11px' }, formatter: function () { return fmt(Number(this.value)) } },
      },
      tooltip: {
        shared: true,
        backgroundColor: '#111',
        borderWidth: 0,
        borderRadius: 8,
        shadow: false,
        padding: 10,
        style: { color: '#fff', fontSize: '12.5px' },
        xDateFormat: '%a %l:%M %p',
        headerFormat: '<span style="font-size:11px;color:#b5b5b0">{point.key}</span><br/>',
        pointFormatter: function () {
          const p = this as Highcharts.Point
          return `<span style="color:${String(p.color)}">●</span> ${multi ? `${p.series.name}: ` : ''}<b>${p.y === null || p.y === undefined ? '—' : fmt(p.y)}</b><br/>`
        },
      },
      plotOptions: {
        series: { animation: false, states: { inactive: { opacity: 0.35 } }, marker: { enabled: false, symbol: 'circle', radius: 4, lineWidth: 2, lineColor: '#fff' } },
        line: { lineWidth: 2, connectNulls: false },
      },
      series: series.map((s) => ({ type: 'line', name: s.name, color: s.color, data: s.data })) as Highcharts.SeriesOptionsType[],
    }
  }, [series, lines, unit, latencyUnit, bands, height])
  return <HighchartsReact highcharts={Highcharts} options={options} immutable />
}
