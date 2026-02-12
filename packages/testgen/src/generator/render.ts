import { ComponentInfo } from '../analyzer';

export function buildRenderHelper(component: ComponentInfo, renderFunction: string): string {
    if (component.props.length > 0) {
        return [
            'const renderUI = (props = {}) =>',
            `  ${renderFunction}(<${component.name} {...defaultProps} {...props} />);`,
        ].join('\n');
    }

    return ['const renderUI = () =>', `  ${renderFunction}(<${component.name} />);`].join('\n');
}
