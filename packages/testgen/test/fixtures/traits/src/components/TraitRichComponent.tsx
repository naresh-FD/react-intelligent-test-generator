import { createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { useForm } from 'react-hook-form';

const DemoContext = createContext({ showDetails: false });

type Props = {
  activeTab: 'overview' | 'settings';
  items: string[];
  showModal: boolean;
};

export function TraitRichComponent({ activeTab, items, showModal }: Props) {
  const navigate = useNavigate();
  const { register } = useForm();
  const contextValue = useContext(DemoContext);
  const { data } = useQuery({
    queryKey: ['items'],
    queryFn: async () => items,
  });
  const selected = useSelector((state: { selected: string }) => state.selected);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    async function loadExtra() {
      await fetch('/api/extra');
    }

    void loadExtra();
  }, []);

  return (
    <div>
      <nav>
        <Link to="/home">Home</Link>
      </nav>

      <div role="tablist">
        <button role="tab" onClick={() => setOpen(true)}>
          Overview
        </button>
        <button role="tab" onClick={() => navigate('/settings')}>
          Settings
        </button>
      </div>

      <form aria-label="profile form">
        <input aria-label="Name" {...register('name')} />
        <select aria-label="Status">
          <option>Open</option>
        </select>
      </form>

      <table aria-label="results table">
        <tbody>
          {items.map((item) => (
            <tr key={item}>
              <td>{item}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul>
        {(data ?? []).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      {contextValue.showDetails && <section>Details</section>}
      {activeTab === 'settings' ? <div>Settings panel</div> : <div>Overview panel</div>}
      {open && <div>Open state</div>}
      {showModal
        ? createPortal(<div role="dialog">Modal {selected}</div>, document.body)
        : null}
    </div>
  );
}
