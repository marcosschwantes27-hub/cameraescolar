import { Icon } from "./Icons";

export type AppView = "attendance" | "enrollment" | "identification";

const navigation = [
  { id: "attendance" as const, label: "Atendimentos", icon: "records" as const },
  { id: "enrollment" as const, label: "Cadastrar", icon: "students" as const },
  { id: "identification" as const, label: "Identificação", icon: "camera" as const },
];

interface NavigationRailProps {
  activeView: AppView;
  onChange: (view: AppView) => void;
}

export function NavigationRail({ activeView, onChange }: NavigationRailProps) {
  return (
    <aside className="navigation-rail" aria-label="Navegação principal">
      <div className="brand-mark" aria-label="Registro Escolar">
        <span>RE</span>
      </div>
      <nav>
        <ul>
          {navigation.map((item) => (
            <li key={item.label}>
              <button
                className={activeView === item.id ? "nav-item nav-item--active" : "nav-item"}
                onClick={() => onChange(item.id)}
                type="button"
                aria-current={activeView === item.id ? "page" : undefined}
                title={item.label}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
