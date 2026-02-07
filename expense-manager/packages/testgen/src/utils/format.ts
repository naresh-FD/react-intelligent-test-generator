export function joinLines(lines: string[]): string {
    return lines.filter((line) => line.trim().length > 0).join('\n');
}
