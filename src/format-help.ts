/** Small shared helper: the token cheat-sheet shown under the format fields. */

import { getLang } from './i18n';

export function dateFormatHelp(): string {
  if (getLang() === 'zh') {
    return [
      '日期占位：YYYY 年 / MM 月 / DD 日 / ddd 周一 / dddd 星期一（小写 MM、DD 补零）',
      '模板占位：{date} {time} {weekday} {weekday-long} {part} {iso} {year} {month} {day}',
    ].join('\n');
  }
  return [
    'Date tokens: YYYY MM DD ddd (Mon) dddd (Monday) HH mm ss — padded with MM/DD/HH.',
    'Template: {date} {time} {weekday} {weekday-long} {part} {iso} {year} {month} {day}',
  ].join('\n');
}

export function timeFormatHelp(): string {
  return getLang() === 'zh' ? '例如 HH:mm、HH:mm:ss、h:mm A' : 'e.g. HH:mm, HH:mm:ss, h:mm A';
}
