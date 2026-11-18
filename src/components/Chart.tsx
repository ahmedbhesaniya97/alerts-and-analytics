import { useMemo } from 'react'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { BarChart3 } from 'lucide-react'
import type { ChartConfig, Session } from '../types'
import { buildChartData, fmtNum, type ChartData } from '../lib/analytics'
import { useStore } from '../lib/store'
import { Empty } from './ui'

const INK = '#0b0b0b'
const INK2 = '#4d4d4a'
const INK3 = '#8a8a85'
const GRID = '#ededea'
const FONT = "'Inter Variable', Inter, system-ui, sans-serif"

function buildOptions(cfg: ChartConfig, data: ChartData, height: number, onPoint: (seriesIndex: number, catIndex: number) => void): Highcharts.Options {
  const isPie = cfg.type === 'pie' || cfg.type === 'donut'
  const hcType = isPie ? 'pie' : cfg.type === 'stacked' ? 'column' : cfg.type
  const unit = data.unit
  const suffix = unit === '%' ? '%' : unit ? ` ${unit}` : ''
  const multi = data.series.length > 1
  const dense = data.categories.length > 16

  const series: Highcharts.SeriesOptionsType[] = isPie
    ? [
        {
          type: 'pie',
          name: data.series[0].name,
          data: data.categories.map((name, i) => ({ name, y: data.series[0].data[i] ?? 0, color: data.categoryColors?.[i] })),
        },
      ]
    : data.series.map(
        (s) =>
          ({
            type: hcType,
            name: s.name,
            color: s.color,
            data: s.data.map((y, i) => (data.categoryColors && !multi ? { y, color: data.categoryColors[i] } : y)),
          }) as Highcharts.SeriesOptionsType,
      )

  return {
    chart: { type: hcType, height, backgroundColor: 'transparent', style: { fontFamily: FONT }, spacing: [8, 4, 8, 4], animation: { duration: 250 } },
    title: { text: undefined },
    credits: { enabled: false },
    accessibility: { enabled: false },
    legend: {
      enabled: multi || isPie,
      align: 'left',
      verticalAlign: 'top',
      margin: 14,
      padding: 0,
      symbolRadius: 2,
      symbolHeight: 9,
      symbolWidth: 9,
      itemStyle: { color: INK2, fontWeight: '400', fontSize: '12px' },
      itemHoverStyle: { color: INK },
    },
    xAxis: {
      categories: data.categories,
      lineColor: '#d6d6d2',
      tickLength: 0,
      crosshair: hcType === 'line' || hcType === 'area' ? { color: '#d6d6d2', width: 1 } : false,
      title: { text: cfg.xLabel || undefined, style: { color: INK3, fontSize: '11.5px' } },
      labels: { style: { color: INK2, fontSize: '11.5px' }, step: dense ? Math.ceil(data.categories.length / 8) : undefined, rotation: 0 },
    },
    yAxis: {
      title: { text: cfg.yLabel || undefined, style: { color: INK3, fontSize: '11.5px' } },
      gridLineColor: GRID,
      min: 0,
      max: data.isPercent ? 100 : undefined,
      allowDecimals: !['count'].includes(cfg.aggregation),
      labels: { style: { color: INK3, fontSize: '11.5px' }, format: `{value}${unit === '%' ? '%' : ''}` },
    },
    tooltip: {
      shared: hcType === 'line' || hcType === 'area',
      backgroundColor: '#111',
      borderWidth: 0,
      borderRadius: 8,
      shadow: false,
      padding: 10,
      style: { color: '#fff', fontSize: '12.5px' },
      headerFormat: '<span style="font-size:11px;color:#b5b5b0">{point.key}</span><br/>',
      pointFormatter: function () {
        const p = this as Highcharts.Point & { percentage?: number }
        const val = p.y === null || p.y === undefined ? '—' : `${fmtNum(p.y)}${suffix}`
        const share = isPie && p.percentage !== undefined && unit !== '%' ? ` · ${Math.round(p.percentage)}%` : ''
        return `<span style="color:${String(p.color)}">●</span> ${isPie ? '' : `${p.series.name}: `}<b>${val}</b>${share}<br/>`
      },
    },
    plotOptions: {
      series: {
        cursor: 'pointer',
        animation: { duration: 300 },
        states: { inactive: { opacity: 0.35 } },
        point: {
          events: {
            click: function () {
              onPoint(isPie ? 0 : this.series.index, this.index)
            },
          },
        },
      },
      column: { stacking: cfg.type === 'stacked' ? 'normal' : undefined, borderRadius: 4, borderWidth: cfg.type === 'stacked' ? 2 : 0, borderColor: '#ffffff', maxPointWidth: 34, groupPadding: 0.12, pointPadding: 0.06 },
      bar: { borderRadius: 4, borderWidth: 0, maxPointWidth: 22, groupPadding: 0.12, pointPadding: 0.06 },
      line: { lineWidth: 2, marker: { enabled: !dense, radius: 4, symbol: 'circle', lineWidth: 2, lineColor: '#fff' }, connectNulls: true },
      area: { lineWidth: 2, fillOpacity: 0.14, marker: { enabled: false, symbol: 'circle' }, connectNulls: true },
      pie: {
        innerSize: cfg.type === 'donut' ? '62%' : 0,
        borderWidth: 2,
        borderColor: '#ffffff',
        showInLegend: true,
        dataLabels: { enabled: true, distance: 14, format: '{point.name} · {point.percentage:.0f}%', style: { color: INK2, fontWeight: '400', fontSize: '12px', textOutline: 'none' }, connectorColor: '#d6d6d2' },
      },
    },
    series,
  }
}

interface Props {
  config: ChartConfig
  sessions: Session[]
  height?: number
}

/** Renders any chart configuration against the given sessions. Clicking a value opens the underlying calls. */
export function ChartView({ config, sessions, height = 300 }: Props) {
  const { index, state, setDrill } = useStore()
  const data = useMemo(() => buildChartData(config, sessions, index, state), [config, sessions, index, state])
  const options = useMemo(
    () =>
      data.empty
        ? null
        : buildOptions(config, data, height, (si, ci) => {
            const ids = data.sessionIds[si]?.[ci] ?? []
            const parts = [data.categories[ci], data.series.length > 1 ? data.series[si].name : null].filter(Boolean)
            setDrill({ title: config.title || 'Chart', subtitle: parts.join(' · '), sessionIds: ids })
          }),
    [config, data, height, setDrill],
  )

  const topic = index.topicById.get(config.topicId)
  if (!topic) {
    return (
      <Empty icon={<BarChart3 size={18} />} title="Pick a topic to start">
        A chart needs a topic to measure.
      </Empty>
    )
  }
  if (!options) {
    return (
      <Empty icon={<BarChart3 size={18} />} title="No data for this chart yet">
        {topic.deletedAt ? 'This topic was deleted and has no values in the selected range.' : 'No calls in the selected filters have a value for this topic. Topics only apply to calls that end after they are switched on.'}
      </Empty>
    )
  }
  return <HighchartsReact highcharts={Highcharts} options={options} immutable />
}
