import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer
} from "recharts";

/**
 * Chart — follower count history line chart using recharts.
 * Requires snapshot.history = [{ timestamp, follower_count }, ...]
 */
export function Chart({ history = [] }) {
    if (history.length < 2) {
        return (
            <div className="chart-placeholder">
                Not enough data for chart yet. Sync at least twice to see trends.
            </div>
        );
    }

    const data = history.map(entry => ({
        date: new Date(entry.timestamp).toLocaleDateString(),
        followers: entry.follower_count
    }));

    return (
        <div className="chart-container">
            <h3 className="chart-title">Follower History</h3>
            <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                    <XAxis
                        dataKey="date"
                        tick={{ fill: "#888", fontSize: 11 }}
                        tickLine={false}
                    />
                    <YAxis
                        tick={{ fill: "#888", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={45}
                    />
                    <Tooltip
                        contentStyle={{
                            background: "#1a1a1a",
                            border: "1px solid #333",
                            borderRadius: "6px",
                            color: "#e0e0e0"
                        }}
                    />
                    <Line
                        type="monotone"
                        dataKey="followers"
                        stroke="#0095f6"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, fill: "#0095f6" }}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
