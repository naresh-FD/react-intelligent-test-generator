import { ComponentInfo } from '../analyzer';

export function buildRenderHelper(component: ComponentInfo): string {
    if (component.props.length > 0) {
        return [
            'const renderUI = (props = {}) =>',
            `  render(<${component.name} {...defaultProps} {...props} />);`,
        ].join('\n');
    }

    return ['const renderUI = () =>', `  render(<${component.name} />);`].join('\n');
}
